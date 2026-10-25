import { describe, expect, it } from 'vitest';
import {
  readSiteSettings,
  renderMaintenancePage,
  sanitizeFooterHtml,
  shouldServeMaintenance,
  writeSiteSettings,
} from '../../src/site';

describe('sanitizeFooterHtml', () => {
  it('keeps multiple links with their hrefs', () => {
    const html = sanitizeFooterHtml(
      'Built with <a href="https://astro.build">Astro</a> · <a href="https://workers.cloudflare.com">Workers</a>',
    );
    expect(html.match(/<a /g)?.length).toBe(2);
    expect(html).toContain('href="https://astro.build"');
    expect(html).toContain('href="https://workers.cloudflare.com"');
  });

  it('strips scripts, event handlers and unknown tags', () => {
    const html = sanitizeFooterHtml(
      '<script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">x</a><iframe src="x"></iframe>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<iframe');
  });

  it('passes plain text through unchanged', () => {
    expect(sanitizeFooterHtml('Astro · Workers')).toBe('Astro · Workers');
  });
});

describe('maintenance mode', () => {
  const html = 'text/html,application/xhtml+xml';

  it('only guards front-end HTML pages while enabled', () => {
    expect(shouldServeMaintenance('/', html, true)).toBe(true);
    expect(shouldServeMaintenance('/about', html, true)).toBe(true);
    expect(shouldServeMaintenance('/articles', html, true)).toBe(true);
    expect(shouldServeMaintenance('/tools/timestamp', html, true)).toBe(true);
    expect(shouldServeMaintenance('/apiary', html, true)).toBe(true);
    expect(shouldServeMaintenance('/', html, false)).toBe(false);
  });

  it('lets API, admin and static assets through', () => {
    const bypassed = [
      '/api',
      '/api/v1/posts',
      '/admin',
      '/admin/about',
      '/_astro/app.css',
      '/css/v2.css',
      '/js/app.js',
      '/assets/cover.png',
      '/media/cabinet.jpg',
      '/favicon.ico',
      '/favicon.svg',
      '/rss.xml',
    ];
    for (const pathname of bypassed) {
      expect(shouldServeMaintenance(pathname, html, true)).toBe(false);
    }
  });

  it('ignores non-HTML requests', () => {
    expect(shouldServeMaintenance('/about', 'application/json', true)).toBe(
      false,
    );
    expect(shouldServeMaintenance('/about', '', true)).toBe(false);
  });

  it('renders a standalone page with the site name and author', () => {
    const page = renderMaintenancePage({
      name: 'Myon',
      author: 'EnkanSakura',
      themeColor: '#EC88C2',
    });
    expect(page).toContain('<!doctype html>');
    expect(page).toContain('维护中');
    expect(page).toContain('Myon');
    expect(page).toContain('EnkanSakura');
    expect(page).toContain('#EC88C2');
    expect(page).not.toContain('<script');
    expect(page).not.toContain('/css/');
    expect(page).toContain('rel="icon" href="/favicon.svg"');
    expect(page).toContain('rel="icon" href="/favicon.ico"');
  });

  it('escapes settings and rejects non-hex theme colors', () => {
    const page = renderMaintenancePage({
      name: '<b>Myon</b>',
      author: 'A&B',
      themeColor: 'red;background:url(x)',
    });
    expect(page).toContain('&lt;b&gt;Myon&lt;/b&gt;');
    expect(page).toContain('A&amp;B');
    expect(page).not.toContain('red;background');
    expect(page).toContain('#EC88C2');
  });
});

describe('site settings in KV', () => {
  function createKv() {
    const data = new Map<string, string>();
    return {
      data,
      kv: {
        get: async (key: string, type?: string) => {
          const raw = data.get(key);
          if (raw === undefined) return null;
          return type === 'json' ? JSON.parse(raw) : raw;
        },
        put: async (key: string, value: string) => {
          data.set(key, value);
        },
      } as unknown as KVNamespace,
    };
  }

  it('falls back to defaults when KV is empty', async () => {
    const { kv } = createKv();
    const settings = await readSiteSettings(kv);
    expect(settings.site_name).toBe('Myon');
    expect(settings.site_subtitle).toBe('同人志');
    expect(settings.home_cover_image).toBe('/media/cabinet.jpg');
  });

  it('merges a patch into the stored JSON and reads it back', async () => {
    const { kv, data } = createKv();
    const written = await writeSiteSettings(kv, {
      site_subtitle: '测试副标题',
      theme_color: '#3366FF',
    });
    expect(written.theme_color).toBe('#3366FF');
    expect(written.site_subtitle).toBe('测试副标题');
    expect(written.site_name).toBe('Myon');
    expect(data.get('site-settings:v1')).toContain('测试副标题');

    const settings = await readSiteSettings(kv);
    expect(settings.theme_color).toBe('#3366FF');
    expect(settings.footer_icp).toContain('ICP备');
  });

  it('ignores unknown keys and non-string values', async () => {
    const { kv, data } = createKv();
    await writeSiteSettings(kv, {
      unknown_key: 'x',
      site_name: 123,
    } as unknown as Parameters<typeof writeSiteSettings>[1]);
    expect(data.get('site-settings:v1')).toBeUndefined();

    data.set(
      'site-settings:v1',
      JSON.stringify({
        unknown_key: 'x',
        site_name: 123,
        theme_color: '#112233',
      }),
    );
    const settings = await readSiteSettings(kv);
    expect(settings.theme_color).toBe('#112233');
    expect(settings.site_name).toBe('Myon');
  });
});
