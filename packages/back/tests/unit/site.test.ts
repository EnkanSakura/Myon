import {
  defaultHomePageNotes,
  homePageNoteSlots,
  siteSettingsPatchSchema,
  toPublicSiteSettings,
} from '@myon/shared';
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

  it('defaults the page-2 figures to empty and falls back to the cover image', async () => {
    const { kv } = createKv();
    const settings = await readSiteSettings(kv);
    expect(settings.home_p2_figure_a).toBe('');
    expect(settings.home_p2_figure_b).toBe('');

    const publicSettings = toPublicSiteSettings(settings);
    expect(publicSettings.home.figures.a).toBe(publicSettings.home.cover.image);
    expect(publicSettings.home.figures.b).toBe(publicSettings.home.cover.image);
  });

  it('uses configured page-2 figures and rewrites legacy /assets/ paths', async () => {
    const { kv } = createKv();
    const written = await writeSiteSettings(kv, {
      home_p2_figure_a: '/media/figure-a.webp',
      home_p2_figure_b: '/assets/figure-b.webp',
    });
    const publicSettings = toPublicSiteSettings(written);
    expect(publicSettings.home.figures.a).toBe('/media/figure-a.webp');
    // 旧设置里的 /assets/<key> 仍要改写成 /media/<key>
    expect(publicSettings.home.figures.b).toBe('/media/figure-b.webp');
  });

  it('defaults home page notes to five slots with the page-3 copy', async () => {
    const { kv } = createKv();
    const settings = await readSiteSettings(kv);
    const notes = toPublicSiteSettings(settings).home.pageNotes;

    // 顺序对应第 2/3/4/5/6 页，固定 5 项；只有第 3 页（index 1）默认有文案
    expect(notes).toHaveLength(homePageNoteSlots);
    expect(notes).toHaveLength(5);
    expect(notes[1]).toBe(defaultHomePageNotes[1]);
    expect(notes[0]).toBe('');
    expect(notes[2]).toBe('');
    expect(notes[3]).toBe('');
    expect(notes[4]).toBe('');
  });

  it('trims custom home_page_notes and keeps exactly five slots', async () => {
    const { kv } = createKv();
    await writeSiteSettings(kv, {
      home_page_notes: JSON.stringify([
        '  第 2 页说明  ',
        '  第 3 页说明  ',
        '  ',
      ]),
    });

    const settings = await readSiteSettings(kv);
    const notes = toPublicSiteSettings(settings).home.pageNotes;
    // 不足 5 项补空串，每项去首尾空白
    expect(notes).toEqual(['第 2 页说明', '第 3 页说明', '', '', '']);
  });
});

describe('home_page_notes patch schema', () => {
  it('accepts a five-item string array', () => {
    const input = { home_page_notes: JSON.stringify(['', '', '', '', '']) };
    expect(siteSettingsPatchSchema.safeParse(input).success).toBe(true);
  });

  it('rejects a six-item array', () => {
    const input = {
      home_page_notes: JSON.stringify(['', '', '', '', '', '']),
    };
    expect(siteSettingsPatchSchema.safeParse(input).success).toBe(false);
  });

  it('rejects an item longer than 240 chars', () => {
    const input = {
      home_page_notes: JSON.stringify(['x'.repeat(241), '', '', '', '']),
    };
    expect(siteSettingsPatchSchema.safeParse(input).success).toBe(false);
  });
});
