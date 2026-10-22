import { describe, expect, it } from 'vitest';
import {
  bangumiInputSchema,
  bangumiPatchSchema,
  defaultHomePageLabels,
  defaultSiteSettings,
  defaultThemeColor,
  galleryInputSchema,
  galleryPatchSchema,
  momentInputSchema,
  momentPatchSchema,
  postInputSchema,
  postPatchSchema,
  siteSettingsPatchSchema,
  themePalette,
  toPublicSiteSettings,
} from '../src/index';

describe('themePalette', () => {
  it('keeps the shipped palette untouched for the default color', () => {
    expect(themePalette(defaultThemeColor)).toEqual({
      pink: '#EC88C2',
      pinkSoft: '#F6BEDC',
      pinkWash: 'rgba(236,136,194,0.18)',
      pinkDeep: '#A93B75',
      onPink: '#17131A',
    });
  });

  it('derives a palette for a custom color', () => {
    const palette = themePalette('#3366FF');
    expect(palette.pink).toBe('#3366FF');
    expect(palette.pinkWash).toBe('rgba(51,102,255,0.18)');
    expect(palette.pinkSoft).not.toBe(palette.pink);
    // 深蓝底上用纸色字才看得清
    expect(palette.onPink).toBe('#F7F3EF');
  });

  it('falls back to the default palette when the value is not a hex color', () => {
    expect(themePalette('not-a-color').pink).toBe(defaultThemeColor);
  });
});

describe('site settings contract', () => {
  it('accepts a partial patch', () => {
    const parsed = siteSettingsPatchSchema.parse({
      theme_color: '#123456',
      footer_icp: '京ICP备 1 号',
    });
    expect(parsed.theme_color).toBe('#123456');
  });

  it('rejects an invalid color and a non-URL rss value', () => {
    expect(
      siteSettingsPatchSchema.safeParse({ theme_color: 'pink' }).success,
    ).toBe(false);
    expect(
      siteSettingsPatchSchema.safeParse({ footer_rss: 'rss.xml' }).success,
    ).toBe(false);
    expect(
      siteSettingsPatchSchema.safeParse({ footer_rss: '/rss.xml' }).success,
    ).toBe(true);
  });

  it('maps to the public shape the frontend consumes', () => {
    const publicSettings = toPublicSiteSettings(defaultSiteSettings);
    expect(publicSettings.themeColor).toBe(defaultThemeColor);
    expect(publicSettings.footerEmail).toBe('hi@myon.studio');
    expect(publicSettings).not.toHaveProperty('site_name');
  });
});

describe('admin patch schemas', () => {
  it('do not inject defaults into partial payloads', () => {
    expect(postPatchSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
    expect(momentPatchSchema.parse({ body: 'x' })).toEqual({ body: 'x' });
    expect(galleryPatchSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(bangumiPatchSchema.parse({ watchedEps: 3 })).toEqual({
      watchedEps: 3,
    });
  });

  it('still apply defaults when creating', () => {
    expect(postInputSchema.parse({ slug: 'a-b', title: 't' })).toMatchObject({
      excerpt: '',
      bodyMd: '',
      status: 'draft',
      category: '随笔',
    });
    expect(momentInputSchema.parse({ body: 'm' })).toMatchObject({
      category: '日常',
      visibility: 'public',
      pinned: false,
    });
    expect(
      galleryInputSchema.parse({ no: 'N-1', name: 'n', category: 'c' }),
    ).toMatchObject({
      displayed: true,
      position: 0,
    });
    expect(bangumiInputSchema.parse({ title: 't' })).toMatchObject({
      status: 'wish',
      totalEps: 0,
      watchedEps: 0,
    });
  });
});

describe('home cover settings', () => {
  it('normalizes seven page labels with defaults for blanks', () => {
    const publicSettings = toPublicSiteSettings({
      ...defaultSiteSettings,
      home_page_labels: JSON.stringify(['自定义 01', '', 'CH.03 四格']),
    });
    expect(publicSettings.home.pages).toHaveLength(7);
    expect(publicSettings.home.pages[0]).toBe('自定义 01');
    expect(publicSettings.home.pages[1]).toBe(defaultHomePageLabels[1]);
    expect(publicSettings.home.pages[6]).toBe(defaultHomePageLabels[6]);
  });

  it('maps preset data blocks and keeps legacy label/value entries working', () => {
    const modern = toPublicSiteSettings({
      ...defaultSiteSettings,
      home_stats: JSON.stringify([
        { preset: 'posts', accent: true },
        { preset: 'words', label: '总字数' },
      ]),
    });
    expect(modern.home.stats).toEqual([
      { preset: 'posts', label: '文章', unit: '篇', accent: true },
      { preset: 'words', label: '总字数', unit: '字', accent: false },
    ]);

    const legacy = toPublicSiteSettings({
      ...defaultSiteSettings,
      home_stats: JSON.stringify([
        { label: '在追', value: '3', unit: '部', accent: true },
      ]),
    });
    expect(legacy.home.stats[0]?.preset).toBe('bangumi_watching');
  });

  it('drops legacy explanation values from home links', () => {
    const publicSettings = toPublicSiteSettings({
      ...defaultSiteSettings,
      home_links: JSON.stringify([
        { label: 'GitHub', value: '@myon', href: 'https://github.com/myon' },
        { label: 'RSS', href: '/articles' },
      ]),
    });
    expect(publicSettings.home.links).toEqual([
      { label: 'GitHub', href: 'https://github.com/myon' },
      { label: 'RSS', href: '/articles' },
    ]);
    expect(
      siteSettingsPatchSchema.safeParse({
        home_links: JSON.stringify([
          { label: 'RSS', value: '订阅', href: '/articles' },
        ]),
      }).success,
    ).toBe(true);
  });

  it('keeps configured Iconify icons and omits invalid ones', () => {
    const publicSettings = toPublicSiteSettings({
      ...defaultSiteSettings,
      home_links: JSON.stringify([
        { label: 'A', href: '#', icon: 'ri:rss-fill' },
        { label: 'B', href: '#' },
        { label: 'C', href: '#', icon: 'not-an-iconify-name' },
      ]),
    });
    expect(publicSettings.home.links).toEqual([
      { label: 'A', href: '#', icon: 'ri:rss-fill' },
      { label: 'B', href: '#' },
      { label: 'C', href: '#' },
    ]);
  });

  it('treats a legacy icon-html value that is an Iconify name as the icon', () => {
    const publicSettings = toPublicSiteSettings({
      ...defaultSiteSettings,
      home_links: JSON.stringify([
        { label: 'A', href: '#', iconHtml: 'fa7-brands:github' },
        {
          label: 'B',
          href: '#',
          iconHtml: '<i class="fa-brands fa-github"></i>',
        },
      ]),
    });
    expect(publicSettings.home.links).toEqual([
      { label: 'A', href: '#', icon: 'fa7-brands:github' },
      { label: 'B', href: '#' },
    ]);
  });

  it('validates Iconify names in the settings patch', () => {
    const withIcon = (icon: string) =>
      JSON.stringify([{ label: 'A', href: '#', icon }]);
    expect(
      siteSettingsPatchSchema.safeParse({ home_links: withIcon('ri:rss-fill') })
        .success,
    ).toBe(true);
    expect(
      siteSettingsPatchSchema.safeParse({
        home_links: withIcon('FA7-brands:github'),
      }).success,
    ).toBe(true);
    expect(
      siteSettingsPatchSchema.safeParse({ home_links: withIcon('mail') })
        .success,
    ).toBe(false);
    expect(
      siteSettingsPatchSchema.safeParse({
        home_links: withIcon('<i class="fa-brands fa-github"></i>'),
      }).success,
    ).toBe(false);
  });

  it('validates page labels and preset stats', () => {
    expect(
      siteSettingsPatchSchema.safeParse({
        home_page_labels: JSON.stringify(['a', 'b']),
      }).success,
    ).toBe(true);
    expect(
      siteSettingsPatchSchema.safeParse({
        home_stats: JSON.stringify([{ preset: 'not_a_preset' }]),
      }).success,
    ).toBe(false);
    expect(
      siteSettingsPatchSchema.safeParse({ footer_icp: '<a href="/x">备案</a>' })
        .success,
    ).toBe(true);
  });
});
