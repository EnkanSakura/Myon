import type { KVNamespace } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchLinkPreview,
  isAllowedPreviewUrl,
  normalizePreviewUrl,
  parseLinkPreviewHtml,
} from '../../src/link-preview';
import type { AppBindings } from '../../src/types';

function createEnv() {
  const kvData = new Map<string, string>();
  const settings = {
    get: async (key: string) => kvData.get(key) ?? null,
    put: async (key: string, value: string) => {
      kvData.set(key, value);
    },
    delete: async (key: string) => {
      kvData.delete(key);
    },
  };
  return {
    env: {
      SETTINGS: settings as unknown as KVNamespace,
    } as unknown as AppBindings,
    kvData,
  };
}

function htmlResponse(html: string, contentType = 'text/html') {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('normalizePreviewUrl', () => {
  it('accepts public http(s) urls', () => {
    expect(isAllowedPreviewUrl('https://example.com/post')).toBe(true);
    expect(isAllowedPreviewUrl('http://example.com:80/')).toBe(true);
    expect(normalizePreviewUrl('https://example.com')?.hostname).toBe(
      'example.com',
    );
  });

  it('rejects non-http(s), credentials, odd ports and private hosts', () => {
    for (const url of [
      'ftp://example.com/file',
      'javascript:alert(1)',
      'https://user:pass@example.com/',
      'https://example.com:8080/',
      'http://localhost/',
      'http://127.0.0.1/',
      'http://10.0.0.10/',
      'http://172.20.1.1/',
      'http://192.168.1.1/',
      'http://169.254.1.1/',
      'http://[::1]/',
      'http://service.internal/',
    ]) {
      expect(isAllowedPreviewUrl(url), url).toBe(false);
    }
  });
});

describe('parseLinkPreviewHtml', () => {
  it('extracts OG metadata, title fallback and icon', () => {
    const html = [
      '<html><head>',
      '<title>页面标题</title>',
      '<meta property="og:title" content="OG 标题">',
      '<meta name="description" content="旧描述">',
      '<meta property="og:description" content="OG 描述 &amp; 更多">',
      '<meta property="og:site_name" content="示例站">',
      '<link rel="icon" href="/icon.png">',
      '</head></html>',
    ].join('');
    const item = parseLinkPreviewHtml(
      html,
      new URL('https://www.example.com/a'),
    );
    expect(item).toEqual({
      title: 'OG 标题',
      description: 'OG 描述 & 更多',
      siteName: '示例站',
      icon: 'https://www.example.com/icon.png',
      host: 'example.com',
    });
  });

  it('falls back to title tag / hostname and default favicon', () => {
    const html = '<title>只有 title</title>';
    const item = parseLinkPreviewHtml(html, new URL('https://example.com/x'));
    expect(item.title).toBe('只有 title');
    expect(item.siteName).toBe('example.com');
    expect(item.description).toBe('');
    expect(item.icon).toBe('https://example.com/favicon.ico');
  });
});

describe('fetchLinkPreview', () => {
  it('returns cached metadata and only fetches once', async () => {
    const { env, kvData } = createEnv();
    const fetchMock = vi.fn(
      async () =>
        await htmlResponse(
          '<title>缓存测试</title><meta property="og:site_name" content="缓存站">',
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const first = await fetchLinkPreview(env, 'https://example.com/post');
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.item.title).toBe('缓存测试');
        expect(first.item.siteName).toBe('缓存站');
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(kvData.size).toBe(1);

      const second = await fetchLinkPreview(env, 'https://example.com/post');
      expect(second.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects private urls without fetching', async () => {
    const { env } = createEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await fetchLinkPreview(env, 'http://127.0.0.1/');
      expect(result).toEqual({ ok: false, reason: 'invalid_url' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails gracefully for non-html responses', async () => {
    const { env } = createEnv();
    const fetchMock = vi.fn(
      async () => await htmlResponse('{"a":1}', 'application/json'),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await fetchLinkPreview(env, 'https://example.com/data');
      expect(result).toEqual({ ok: false, reason: 'fetch_failed' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
