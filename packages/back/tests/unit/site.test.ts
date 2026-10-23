import { describe, expect, it } from 'vitest';
import {
  readSiteSettings,
  sanitizeFooterHtml,
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
