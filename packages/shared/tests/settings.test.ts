import { describe, expect, it } from 'vitest';
import {
  bangumiInputSchema,
  bangumiPatchSchema,
  defaultHomeLinks,
  defaultSiteSettings,
  defaultThemeColor,
  galleryInputSchema,
  galleryPatchSchema,
  getMessages,
  momentInputSchema,
  momentPatchSchema,
  postInputSchema,
  postPatchSchema,
  siteSettingsPatchSchema,
  staticHomeStats,
  t,
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

describe('i18n messages', () => {
  it('reads zh-CN copy through dot paths', () => {
    const messages = getMessages();
    expect(t('home.title')).toBe(messages.home.title);
    expect(t('home.endTitle')).toBe(messages.home.endTitle);
    expect(t('home.title')).toBeTruthy();
  });

  it('falls back to the key when a message is missing', () => {
    expect(t('home.notExists')).toBe('home.notExists');
  });

  it('exposes the default locale message tree', () => {
    const messages = getMessages();
    expect(messages.home.pageLabels).toHaveLength(7);
    expect(messages.home.pageNotes).toHaveLength(5);
  });
});

describe('static site config', () => {
  it('maps home stats from structure + locale labels only', () => {
    const labels = getMessages().home.stats;
    expect(staticHomeStats()).toEqual([
      {
        preset: 'latest_update',
        label: labels.latest_update.label,
        unit: labels.latest_update.unit,
        accent: false,
      },
      {
        preset: 'bangumi_watching',
        label: labels.bangumi_watching.label,
        unit: labels.bangumi_watching.unit,
        accent: true,
      },
      {
        preset: 'gallery',
        label: labels.gallery.label,
        unit: labels.gallery.unit,
        accent: false,
      },
    ]);
  });
});

describe('site settings contract', () => {
  it('accepts a partial patch of KV-backed settings', () => {
    const parsed = siteSettingsPatchSchema.parse({
      theme_color: '#123456',
      footer_icp: '京ICP备 1 号',
    });
    expect(parsed.theme_color).toBe('#123456');
  });

  it('ignores keys that moved to static config', () => {
    const parsed = siteSettingsPatchSchema.parse({
      home_title: '自定义标题',
      home_page_notes: JSON.stringify(['x']),
    });
    expect(parsed).not.toHaveProperty('home_title');
    expect(parsed).not.toHaveProperty('home_page_notes');
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
    const messages = getMessages();
    expect(publicSettings.themeColor).toBe(defaultThemeColor);
    expect(publicSettings.footerEmail).toBe('hi@myon.studio');
    expect(publicSettings).not.toHaveProperty('site_name');
    // 版权由作者 + 年份生成，不再从 KV 读取
    expect(publicSettings.footerCopyright).toBe(
      `© ${new Date().getFullYear()} Myon`,
    );
    // 固定文案来自静态资源（内容认文件，不在测试里写死）
    expect(publicSettings.home.title).toBe(messages.home.title);
    expect(publicSettings.home.cover.badge).toBe(messages.home.coverBadge);
    expect(publicSettings.end.title).toBe(messages.home.endTitle);
    expect(publicSettings.home.pages).toHaveLength(7);
    expect(publicSettings.home.pageNotes).toHaveLength(5);
    // 首页联系方式仍来自 KV，默认值与 defaultHomeLinks 一致
    expect(publicSettings.home.links).toEqual(defaultHomeLinks);
  });

  it('keeps runtime fields from KV and static fields from i18n', () => {
    const publicSettings = toPublicSiteSettings({
      ...defaultSiteSettings,
      site_name: '测试站',
      site_author: '测试作者',
      home_cover_image: '/media/cover.webp',
      home_afterword_body: '自定义后记',
    });
    expect(publicSettings.name).toBe('测试站');
    expect(publicSettings.home.cover.image).toBe('/media/cover.webp');
    expect(publicSettings.end.afterword.body).toBe('自定义后记');
    expect(publicSettings.home.title).toBe(getMessages().home.title);
  });

  it('normalizes custom home links from KV', () => {
    const publicSettings = toPublicSiteSettings({
      ...defaultSiteSettings,
      home_links: JSON.stringify([
        { label: '邮件', href: 'mailto:hi@example.com', icon: 'RI:Rss-Fill' },
        { label: '站点', href: '/' },
      ]),
    });
    expect(publicSettings.home.links).toEqual([
      { label: '邮件', href: 'mailto:hi@example.com', icon: 'ri:rss-fill' },
      { label: '站点', href: '/' },
    ]);
  });

  it('validates home links in the patch schema', () => {
    expect(
      siteSettingsPatchSchema.safeParse({
        home_links: JSON.stringify([
          {
            label: 'GitHub',
            href: 'https://github.com/x',
            icon: 'ri:github-fill',
          },
        ]),
      }).success,
    ).toBe(true);
    expect(
      siteSettingsPatchSchema.safeParse({
        home_links: JSON.stringify([
          { label: 'x', href: 'javascript:alert(1)' },
        ]),
      }).success,
    ).toBe(false);
    expect(
      siteSettingsPatchSchema.safeParse({
        home_links: JSON.stringify(
          Array.from({ length: 7 }, () => ({ label: 'x', href: '/' })),
        ),
      }).success,
    ).toBe(false);
    expect(
      siteSettingsPatchSchema.safeParse({
        home_links: JSON.stringify([
          { label: 'x', href: '/', icon: '<i class="x"></i>' },
        ]),
      }).success,
    ).toBe(false);
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

  it('still apply non-category defaults when creating', () => {
    // category 是必填项，不再有服务端默认值
    expect(postInputSchema.safeParse({ slug: 'a-b', title: 't' }).success).toBe(
      false,
    );
    expect(momentInputSchema.safeParse({ body: 'm' }).success).toBe(false);

    expect(
      postInputSchema.parse({ slug: 'a-b', title: 't', category: '随笔' }),
    ).toMatchObject({
      excerpt: '',
      bodyMd: '',
      status: 'draft',
      category: '随笔',
    });
    expect(
      momentInputSchema.parse({ body: 'm', category: '日常' }),
    ).toMatchObject({
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
