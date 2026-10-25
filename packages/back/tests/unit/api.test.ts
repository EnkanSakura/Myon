import { describe, expect, it, vi } from 'vitest';
import app from '../../src/app';
import type { AppBindings } from '../../src/types';

/**
 * 够用的 D1 桩：health 走原生 `prepare().first()`，业务路由走 drizzle
 * （内部按是否带字段分别调 `raw()` / `all()`）。按 SQL 区分，避免互相干扰。
 */
interface EnvStubs {
  /** /stats 的「类型 × 状态」聚合行：[subjectType, status, count]。 */
  bangumiGroups?: Array<[string, string, number]>;
  /** 追番列表查询返回的行（按 schema 列顺序的 values 数组）。 */
  bangumiList?: unknown[][];
  /** 后台 PATCH 读取单条追番时返回的行（按 schema 列顺序的 values 数组）。 */
  bangumiRow?: unknown[];
}

function createEnv(
  environment = 'test',
  adminToken?: string,
  stubs: EnvStubs = {},
) {
  /** 执行过的 SQL，供「确实写了 site_content」这类断言用。 */
  const statements: string[] = [];

  const statement = (sql: string) => {
    const normalized = sql.toLowerCase();
    const isHealth = sql.includes('SELECT 1 AS ok');
    const isBangumiGroup =
      normalized.includes('from "bangumi_shows"') &&
      normalized.includes('group by');
    const isBangumiById =
      normalized.includes('from "bangumi_shows"') &&
      normalized.includes(' where ');
    const isBangumiList =
      normalized.includes('from "bangumi_shows"') &&
      !isBangumiGroup &&
      !isBangumiById &&
      !normalized.includes('count(*)');

    // drizzle 的 select 带字段时走 raw()；行是 values 数组而不是对象。
    const rows = isBangumiGroup
      ? (stubs.bangumiGroups ?? [])
      : isBangumiById && stubs.bangumiRow
        ? [stubs.bangumiRow]
        : isBangumiList && stubs.bangumiList
          ? stubs.bangumiList
          : [];

    const stmt = {
      bind: () => stmt,
      first: async () => (isHealth ? { ok: 1 } : null),
      all: async () => ({ results: [], success: true, meta: {} }),
      raw: async () => rows,
      run: async () => ({ success: true, meta: {} }),
    };
    return stmt;
  };

  // 够用的 KV 桩：站点设置就是一份 JSON。
  const kvData = new Map<string, string>();
  const settings = {
    get: async (key: string, type?: string) => {
      const raw = kvData.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => {
      kvData.set(key, value);
    },
    delete: async (key: string) => {
      kvData.delete(key);
    },
  };

  // 够用的 R2 桩：媒体库列表直接遍历对象。
  const objects = new Map<
    string,
    { key: string; size: number; customMetadata?: Record<string, string> }
  >();
  const media = {
    put: async (
      key: string,
      _value: unknown,
      options?: { customMetadata?: Record<string, string> },
    ) => {
      objects.set(key, {
        key,
        size: 1,
        customMetadata: options?.customMetadata,
      });
      return { key };
    },
    delete: async (key: string) => {
      objects.delete(key);
    },
    head: async (key: string) => objects.get(key) ?? null,
    list: async () => ({
      objects: [...objects.values()],
      truncated: false,
    }),
  };

  return {
    DB: {
      prepare: (sql: string) => {
        statements.push(sql);
        return statement(sql);
      },
    },
    MEDIA: media,
    SETTINGS: settings,
    ENVIRONMENT: environment,
    ADMIN_TOKEN: adminToken,
    statements,
  } as unknown as AppBindings & { statements: string[] };
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
    expect(body.settings.name).toBe('Myon');
    expect(body.settings.subtitle).toBe('同人志');
    expect(body.settings.description).toBe('一个人的二次元生活志');
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

  it('filters the bangumi collection by type and supports recent sorting', async () => {
    for (const type of ['anime', 'book', 'music', 'game', 'real']) {
      const res = await app.request(`/api/v1/bangumi?type=${type}`, {}, env);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      });
    }

    const recent = await app.request('/api/v1/bangumi?sort=recent', {}, env);
    expect(recent.status).toBe(200);
    expect((await recent.json()) as { total: number }).toMatchObject({
      total: 0,
    });

    const invalid = await app.request('/api/v1/bangumi?type=comic', {}, env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid_subject_type' });
  });

  it('returns subjectType on bangumi items', async () => {
    const listEnv = createEnv('test', undefined, {
      bangumiList: [
        [
          'bg_1',
          'book',
          1,
          '某本书',
          'watching',
          10,
          2,
          null,
          null,
          null,
          '2026-10-01T00:00:00.000Z',
        ],
      ],
    });
    const res = await app.request('/api/v1/bangumi', {}, listEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; subjectType: string }>;
    };
    expect(body.items[0]?.id).toBe('bg_1');
    expect(body.items[0]?.subjectType).toBe('book');
  });

  it('reports zeroed site stats without data', async () => {
    const res = await app.request('/api/v1/stats', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lastUpdated: null,
      posts: { published: 0, draft: 0, words: 0 },
      moments: { total: 0 },
      gallery: { total: 0, displayed: 0, categories: [] },
      bangumi: {
        total: 0,
        watching: 0,
        byType: {
          anime: { total: 0, watching: 0 },
          book: { total: 0, watching: 0 },
          music: { total: 0, watching: 0 },
          game: { total: 0, watching: 0 },
          real: { total: 0, watching: 0 },
        },
        byStatus: { watching: 0, watched: 0, wish: 0, paused: 0 },
      },
      media: { total: 0 },
      tools: { total: 0, enabled: 0 },
      categories: { posts: [], moments: [] },
    });
  });

  it('aggregates bangumi stats across every subject type and status', async () => {
    const statsEnv = createEnv('test', undefined, {
      bangumiGroups: [
        ['anime', 'watching', 2],
        ['anime', 'watched', 1],
        ['book', 'watching', 1],
        ['music', 'paused', 1],
      ],
    });
    const res = await app.request('/api/v1/stats', {}, statsEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      bangumi: {
        total: number;
        watching: number;
        byType: Record<string, { total: number; watching: number }>;
        byStatus: Record<string, number>;
      };
    };
    expect(body.bangumi.total).toBe(5);
    expect(body.bangumi.watching).toBe(3);
    expect(body.bangumi.byType.anime).toEqual({ total: 3, watching: 2 });
    expect(body.bangumi.byType.book).toEqual({ total: 1, watching: 1 });
    expect(body.bangumi.byType.music).toEqual({ total: 1, watching: 0 });
    expect(body.bangumi.byType.game).toEqual({ total: 0, watching: 0 });
    expect(body.bangumi.byType.real).toEqual({ total: 0, watching: 0 });
    expect(body.bangumi.byStatus).toEqual({
      watching: 3,
      watched: 1,
      wish: 0,
      paused: 1,
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
        body: JSON.stringify({
          theme_color: '#3366FF',
          site_subtitle: '测试副标题',
        }),
      },
      adminEnv,
    );
    expect(res.status).toBe(200);

    const readBack = await app.request(
      '/api/v1/admin/settings',
      { headers: { 'x-admin-token': 'secret-token' } },
      adminEnv,
    );
    const settings = (await readBack.json()) as {
      settings: Record<string, string>;
    };
    expect(settings.settings.theme_color).toBe('#3366FF');
    expect(settings.settings.site_subtitle).toBe('测试副标题');
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

  it('no longer exposes admin bangumi edit endpoints', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const res = await app.request(
        '/api/v1/admin/bangumi',
        { method, headers: auth },
        adminEnv,
      );
      expect(res.status).toBe(404);
    }
    for (const method of ['PATCH', 'DELETE'] as const) {
      const res = await app.request(
        '/api/v1/admin/bangumi/bg_1',
        { method, headers: auth },
        adminEnv,
      );
      expect(res.status).toBe(404);
    }
  });

  it('uploads an image to R2 and registers it', async () => {
    const form = new FormData();
    const webp = Buffer.from(
      'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJQBOgCHwAP7+4AAAAA==',
      'base64',
    );
    form.set('file', new File([webp], 'pixel.webp', { type: 'image/webp' }));

    const res = await app.request(
      '/api/v1/admin/media',
      { method: 'POST', headers: auth, body: form },
      adminEnv,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { key: string; mime: string } };
    expect(body.item.key).toMatch(/^uploads\//);
    expect(body.item.mime).toBe('image/webp');
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

describe('admin GIF to WebP proxy', () => {
  const auth = { 'x-admin-token': 'secret-token' };
  const gifWebpEnv = {
    ...createEnv('test', 'secret-token'),
    IMG2WEBP_TOKEN: 'img2webp-secret',
  } as AppBindings;

  function gifForm() {
    const form = new FormData();
    form.set(
      'file',
      new File([Buffer.from('GIF89a', 'ascii')], 'anim.gif', {
        type: 'image/gif',
      }),
    );
    return form;
  }

  it('forwards the GIF to img2webp with the server secret and returns WebP', async () => {
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00]);
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(webp, { headers: { 'content-type': 'image/webp' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const res = await app.request(
        '/api/v1/admin/media/gif-webp',
        { method: 'POST', headers: auth, body: gifForm() },
        gifWebpEnv,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.myon.top/img2webp');
      expect((init as RequestInit).headers).toMatchObject({
        authorization: 'Bearer img2webp-secret',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns 503 when the img2webp secret is missing', async () => {
    const res = await app.request(
      '/api/v1/admin/media/gif-webp',
      { method: 'POST', headers: auth, body: gifForm() },
      createEnv('test', 'secret-token'),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(
      'img2webp_not_configured',
    );
  });

  it('rejects non-GIF uploads', async () => {
    const form = new FormData();
    form.set(
      'file',
      new File([Buffer.from('x')], 'a.png', { type: 'image/png' }),
    );
    const res = await app.request(
      '/api/v1/admin/media/gif-webp',
      { method: 'POST', headers: auth, body: form },
      gifWebpEnv,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'gif_required',
    );
  });
});

describe('admin about API', () => {
  const auth = { 'x-admin-token': 'secret-token' };
  const json = { ...auth, 'content-type': 'application/json' };
  // 独立一份环境，方便断言这次 PUT 真的写了 site_content。
  const aboutEnv = createEnv('test', 'secret-token');

  it('requires the admin token', async () => {
    const res = await app.request(
      '/api/v1/admin/about',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: '# 关于' }),
      },
      aboutEnv,
    );
    expect(res.status).toBe(401);
  });

  it('rejects malformed and invalid payloads before writing', async () => {
    const invalid = await app.request(
      '/api/v1/admin/about',
      {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({ markdown: 123 }),
      },
      aboutEnv,
    );
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toBe(
      'validation_failed',
    );

    const malformed = await app.request(
      '/api/v1/admin/about',
      { method: 'PUT', headers: json, body: 'not-json' },
      aboutEnv,
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid_json' });
  });

  it('writes the about row and returns rendered html', async () => {
    const res = await app.request(
      '/api/v1/admin/about',
      {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({
          markdown: '## 关于本站\n\n这里是正文。',
        }),
      },
      aboutEnv,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      item: {
        key: string;
        markdown: string;
        html: string;
        updatedAt: string;
      };
    };
    expect(body.item.key).toBe('about');
    expect(body.item.markdown).toContain('关于本站');
    expect(body.item.html).toContain('<h2>关于本站</h2>');
    expect(body.item.html).toContain('这里是正文');
    expect(body.item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const executed = aboutEnv.statements.map((sql) => sql.toLowerCase());
    expect(
      executed.some(
        (sql) => sql.includes('insert') && sql.includes('site_content'),
      ),
    ).toBe(true);
    expect(
      executed.some(
        (sql) => sql.includes('site_content') && sql.includes('on conflict'),
      ),
    ).toBe(true);
  });
});

describe('tools and traffic API', () => {
  const auth = { 'x-admin-token': 'secret-token' };
  const json = { ...auth, 'content-type': 'application/json' };

  it('returns empty tools and a zero-filled 30 day traffic window', async () => {
    const toolsRes = await app.request('/api/v1/tools', {}, env);
    expect(toolsRes.status).toBe(200);
    expect(await toolsRes.json()).toEqual({ items: [] });

    const trafficRes = await app.request('/api/v1/traffic', {}, env);
    expect(trafficRes.status).toBe(200);
    const traffic = (await trafficRes.json()) as {
      days: { date: string; pv: number; uv: number }[];
      totals: { pv: number; uv: number };
      today: { date: string; pv: number; uv: number };
    };
    expect(traffic.days).toHaveLength(30);
    expect(traffic.totals).toEqual({ pv: 0, uv: 0 });
    expect(traffic.days[traffic.days.length - 1]).toEqual(traffic.today);
  });

  it('guards the admin tools API and validates payloads', async () => {
    const unauth = await app.request('/api/v1/admin/tools', {}, adminEnv);
    expect(unauth.status).toBe(401);

    const invalid = await app.request(
      '/api/v1/admin/tools',
      {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: '', href: 'javascript:alert(1)' }),
      },
      adminEnv,
    );
    expect(invalid.status).toBe(400);
    const body = (await invalid.json()) as {
      error: string;
      issues: unknown[];
    };
    expect(body.error).toBe('validation_failed');
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('creates a tool with defaults', async () => {
    const res = await app.request(
      '/api/v1/admin/tools',
      {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          slug: 'test-tool',
          name: '测试工具',
          description: '一句说明',
        }),
      },
      adminEnv,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      item: {
        id: string;
        name: string;
        enabled: boolean;
        position: number;
        slug: string;
        toolKey: string | null;
        href: string | null;
      };
    };
    expect(body.item.id).toMatch(/^tool_/);
    expect(body.item.slug).toBe('test-tool');
    expect(body.item.name).toBe('测试工具');
    expect(body.item.enabled).toBe(true);
    expect(body.item.position).toBe(0);
    expect(body.item.toolKey).toBeNull();
    expect(body.item.href).toBeNull();
  });

  it('rejects an invalid tool slug before writing', async () => {
    const res = await app.request(
      '/api/v1/admin/tools',
      {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ slug: 'Bad Slug', name: '测试工具' }),
      },
      adminEnv,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'validation_failed',
    );
  });

  it('returns 404 when patching a missing tool', async () => {
    const res = await app.request(
      '/api/v1/admin/tools/missing',
      {
        method: 'PATCH',
        headers: json,
        body: JSON.stringify({ name: '改个名' }),
      },
      adminEnv,
    );
    expect(res.status).toBe(404);
  });
});

describe('admin access mode', () => {
  /**
   * 造一份 RS256 的 Access JWT 和对应 JWKS：`requireAdmin` 走 cookie 校验时
   * 会用 `verifyAccessJwt` 拉 JWKS 验签，这里用同一对密钥签名。
   */
  async function createAccessToken(options: {
    teamDomain: string;
    aud: string;
  }) {
    const keyPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as { publicKey: CryptoKey; privateKey: CryptoKey };
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const kid = 'unit-test-kid';
    const now = Math.floor(Date.now() / 1000);
    const base64Url = (bytes: Uint8Array) => {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    };
    const encode = (value: unknown) =>
      base64Url(new TextEncoder().encode(JSON.stringify(value)));
    const data = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode({
      aud: [options.aud],
      iss: `https://${options.teamDomain}`,
      iat: now,
      exp: now + 600,
    })}`;
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      new TextEncoder().encode(data),
    );
    return {
      token: `${data}.${base64Url(new Uint8Array(signature))}`,
      jwks: { keys: [{ ...publicJwk, kid, alg: 'RS256' }] },
    };
  }

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

  it('accepts the CF_Authorization cookie for API requests', async () => {
    const teamDomain = 'cookie-auth.example.com';
    const aud = 'cookie-auth-aud';
    const { token, jwks } = await createAccessToken({ teamDomain, aud });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(jwks), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    try {
      const cookieEnv = {
        ...createEnv('test'),
        ACCESS_TEAM_DOMAIN: teamDomain,
        ACCESS_AUD: aud,
      } as unknown as AppBindings;

      const ok = await app.request(
        '/api/v1/admin/settings',
        { headers: { cookie: `theme=dark; CF_Authorization=${token}` } },
        cookieEnv,
      );
      expect(ok.status).toBe(200);
      expect(await ok.json()).toHaveProperty('settings');

      const bad = await app.request(
        '/api/v1/admin/settings',
        { headers: { cookie: 'CF_Authorization=not-a-jwt' } },
        cookieEnv,
      );
      expect(bad.status).toBe(401);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('bangumi cover proxy', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('proxies a Bangumi cover with long-lived cache headers', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(png, { headers: { 'content-type': 'image/png' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const src = 'https://lain.bgm.tv/pic/cover/l/aa/bb/cache-test-1.jpg';
      const res = await app.request(
        '/api/v1/bangumi/cover?src=' + encodeURIComponent(src),
        {},
        createEnv('test'),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('cache-control')).toContain('max-age=31536000');
      expect(await res.arrayBuffer()).toEqual(png.buffer);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('copies a cached cover into a fresh mutable response', async () => {
    const cached = new Response(png, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
    const cacheStub = {
      match: vi.fn(async () => cached),
      put: vi.fn(async () => undefined),
    };
    vi.stubGlobal('caches', { default: cacheStub });
    const fetchMock = vi.fn(async () => {
      throw new Error('cache hit 不应回源');
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const src = 'https://lain.bgm.tv/pic/cover/l/cc/dd/cache-hit-test.jpg';
      const res = await app.request(
        `/api/v1/bangumi/cover?src=${encodeURIComponent(src)}`,
        {},
        createEnv('test'),
      );
      expect(res.status).toBe(200);
      // cache.match() 返回的响应头在 Workers 运行时不可变，直接返回会被
      // secureHeaders() 撞出 "Can't modify immutable headers"（接口 500）。
      // 这里断言拿到的是新响应、头可写、内容与缓存一致。
      expect(res).not.toBe(cached);
      expect(() => res.headers.set('x-test', '1')).not.toThrow();
      expect(res.headers.get('cache-control')).toContain('max-age=31536000');
      expect(await res.arrayBuffer()).toEqual(png.buffer);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects non-Bangumi cover sources', async () => {
    const res = await app.request(
      '/api/v1/bangumi/cover?src=' +
        encodeURIComponent('https://evil.example/cover.jpg'),
      {},
      createEnv('test'),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'invalid_cover_url',
    );
  });

  it('rejects upstream responses that are not images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>nope</html>', {
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );
    try {
      const res = await app.request(
        '/api/v1/bangumi/cover?src=' +
          encodeURIComponent('https://lain.bgm.tv/pic/cover/l/html-test.jpg'),
        {},
        createEnv('test'),
      );
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toBe(
        'invalid_cover_content_type',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
