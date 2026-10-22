import { describe, expect, it } from 'vitest';
import app from '../../src/app';
import type { AppBindings } from '../../src/types';

/**
 * 够用的 D1 桩：health 走原生 `prepare().first()`，业务路由走 drizzle
 * （内部会调 `all()`）。按 SQL 区分，避免两套查询互相干扰。
 */
function createEnv(environment = 'test', adminToken?: string) {
  const statement = (sql: string) => {
    const isHealth = sql.includes('SELECT 1 AS ok');
    const stmt = {
      bind: () => stmt,
      first: async () => (isHealth ? { ok: 1 } : null),
      all: async () => ({ results: [], success: true, meta: {} }),
      raw: async () => [],
      run: async () => ({ success: true, meta: {} }),
    };
    return stmt;
  };

  return {
    DB: { prepare: (sql: string) => statement(sql) },
    MEDIA: {
      put: async (key: string) => ({ key }),
      delete: async () => undefined,
    },
    ENVIRONMENT: environment,
    ADMIN_TOKEN: adminToken,
  } as unknown as AppBindings;
}

const env = createEnv();
const adminEnv = createEnv('test', 'secret-token');

describe('GET /api/health', () => {
  it('returns ok, the environment and the served API version', async () => {
    const res = await app.request('/api/health', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      environment: string;
      apiVersion: string;
    };
    expect(body.ok).toBe(true);
    expect(body.environment).toBe('test');
    expect(body.apiVersion).toBe('v1');
  });
});

// 版本文本是契约的一部分，这里刻意写死字面量而不用 @myon/shared 的常量：
// 如果实现和测试共用同一个常量，改错版本号时两边会一起静默通过。
describe('API versioning', () => {
  it('serves content routes under /api/v1', async () => {
    const list = await app.request('/api/v1/posts', {}, env);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });

    const about = await app.request('/api/v1/about', {}, env);
    expect(about.status).toBe(200);
    expect(await about.json()).toEqual({
      key: 'about',
      markdown: '',
      html: '',
      updatedAt: null,
    });
  });

  it('no longer exposes the unversioned content routes', async () => {
    for (const path of ['/api/posts', '/api/about']) {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('keeps the health probe unversioned', async () => {
    const res = await app.request('/api/v1/health', {}, env);
    expect(res.status).toBe(404);
  });

  it('returns a JSON 404 inside a known version', async () => {
    const res = await app.request('/api/v1/nope', {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('GET /api/v1/site', () => {
  it('falls back to the default settings when D1 has no rows', async () => {
    const res = await app.request('/api/v1/site', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Record<string, string> };
    expect(body.settings.themeColor).toBe('#EC88C2');
    expect(body.settings.footerRss).toBe('/rss.xml');
    expect(body.settings.footerIcp).toContain('ICP备');
  });
});

describe('GET /api/v1/icons', () => {
  it('returns an empty list when no names are requested', async () => {
    const res = await app.request('/api/v1/icons', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ icons: [] });
  });

  it('rejects malformed and too many icon names before calling upstream', async () => {
    const invalid = await app.request('/api/v1/icons?names=mail', {}, env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid_icon_name' });

    const names = Array.from(
      { length: 13 },
      (_, index) => `ri:icon-${index}`,
    ).join(',');
    const tooMany = await app.request(`/api/v1/icons?names=${names}`, {}, env);
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toEqual({ error: 'too_many_icons' });
  });
});

describe('content categories', () => {
  it('returns empty category lists without data', async () => {
    const res = await app.request('/api/v1/categories', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ posts: [], moments: [] });
  });

  it('exposes public moments', async () => {
    const res = await app.request('/api/v1/moments', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it('exposes the gallery and bangumi collections', async () => {
    const gallery = await app.request('/api/v1/gallery', {}, env);
    expect(gallery.status).toBe(200);
    expect(await gallery.json()).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });

    const bangumi = await app.request('/api/v1/bangumi', {}, env);
    expect(bangumi.status).toBe(200);
    expect(await bangumi.json()).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it('reports zeroed site stats without data', async () => {
    const res = await app.request('/api/v1/stats', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lastUpdated: null,
      posts: { published: 0, draft: 0, words: 0 },
      moments: { total: 0 },
      gallery: { total: 0, displayed: 0, categories: [] },
      bangumi: { total: 0, watching: 0 },
      media: { total: 0 },
      categories: { posts: [], moments: [] },
    });
  });
});

describe('admin settings API', () => {
  it('stays closed when ADMIN_TOKEN is not configured', async () => {
    const res = await app.request('/api/v1/admin/settings', {}, env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'admin_not_configured' });
  });

  it('rejects a missing or wrong token', async () => {
    const missing = await app.request('/api/v1/admin/settings', {}, adminEnv);
    expect(missing.status).toBe(401);

    const wrong = await app.request(
      '/api/v1/admin/settings',
      { headers: { 'x-admin-token': 'nope' } },
      adminEnv,
    );
    expect(wrong.status).toBe(401);
  });

  it('reads settings with a valid token', async () => {
    const res = await app.request(
      '/api/v1/admin/settings',
      { headers: { 'x-admin-token': 'secret-token' } },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Record<string, string> };
    expect(body.settings.theme_color).toBe('#EC88C2');
  });

  it('validates the patch payload before writing', async () => {
    const res = await app.request(
      '/api/v1/admin/settings',
      {
        method: 'PUT',
        headers: {
          'x-admin-token': 'secret-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ theme_color: 'pink' }),
      },
      adminEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('validation_failed');
  });

  it('writes a valid patch', async () => {
    const res = await app.request(
      '/api/v1/admin/settings',
      {
        method: 'PUT',
        headers: {
          'x-admin-token': 'secret-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ theme_color: '#3366FF' }),
      },
      adminEnv,
    );
    expect(res.status).toBe(200);
  });
});

describe('admin content write API', () => {
  const auth = { 'x-admin-token': 'secret-token' };
  const json = { ...auth, 'content-type': 'application/json' };

  it('rejects invalid payloads before touching the database', async () => {
    const res = await app.request(
      '/api/v1/admin/posts',
      {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ slug: 'Bad Slug', title: '' }),
      },
      adminEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe('validation_failed');
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('creates a post and a moment', async () => {
    const postRes = await app.request(
      '/api/v1/admin/posts',
      {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          slug: 'e2e-draft',
          title: '草稿标题',
          status: 'draft',
        }),
      },
      adminEnv,
    );
    expect(postRes.status).toBe(201);
    const post = (await postRes.json()) as {
      item: { category: string; readingMinutes: number };
    };
    expect(post.item.category).toBe('随笔');
    expect(post.item.readingMinutes).toBeGreaterThan(0);

    const momentRes = await app.request(
      '/api/v1/admin/moments',
      {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ body: '今天的动态', category: '日常' }),
      },
      adminEnv,
    );
    expect(momentRes.status).toBe(201);
  });

  it('uploads an image to R2 and registers it', async () => {
    const form = new FormData();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    form.set('file', new File([png], 'pixel.png', { type: 'image/png' }));

    const res = await app.request(
      '/api/v1/admin/media',
      { method: 'POST', headers: auth, body: form },
      adminEnv,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { key: string; mime: string } };
    expect(body.item.key).toMatch(/^uploads\//);
    expect(body.item.mime).toBe('image/png');
  });

  it('rejects an unsupported upload type', async () => {
    const form = new FormData();
    form.set(
      'file',
      new File([Buffer.from('hello')], 'note.txt', { type: 'text/plain' }),
    );

    const res = await app.request(
      '/api/v1/admin/media',
      { method: 'POST', headers: auth, body: form },
      adminEnv,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'unsupported_type',
    );
  });

  it('reports bangumi sync as skipped without credentials', async () => {
    const res = await app.request(
      '/api/v1/admin/bangumi/sync',
      { method: 'POST', headers: auth },
      adminEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      synced: 0,
      reason: 'not_configured',
    });
  });
});

describe('admin access mode', () => {
  const accessEnv = {
    ...createEnv('test'),
    ACCESS_TEAM_DOMAIN: 'demo.cloudflareaccess.com',
    ACCESS_AUD: 'demo-aud',
  } as unknown as AppBindings;

  it('requires the Access JWT header once Access is configured', async () => {
    const missing = await app.request('/api/v1/admin/settings', {}, accessEnv);
    expect(missing.status).toBe(401);

    const malformed = await app.request(
      '/api/v1/admin/settings',
      { headers: { 'cf-access-jwt-assertion': 'not.a.jwt' } },
      accessEnv,
    );
    expect(malformed.status).toBe(401);
  });
});
