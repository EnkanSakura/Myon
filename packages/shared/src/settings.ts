import { z } from 'zod';
import { iconifyNamePattern, isIconifyIconName } from './icons';

/** 站点设置的键、默认值与校验。后台可改，前台与 API 共读同一份。 */

export const siteSettingKeys = [
  'site_name',
  'site_subtitle',
  'site_description',
  'site_author',
  'site_email',
  'theme_color',
  'footer_copyright',
  'footer_tech',
  'footer_icp',
  'footer_rss',
  'footer_email',
  'default_theme',
  'comments_enabled',
  'home_title',
  'home_lead',
  'home_page_labels',
  'home_stats',
  'home_links',
  'home_cover_image',
  'home_cover_badge',
  'home_cover_note',
  'home_end_title',
  'home_end_lead',
  'home_afterword_body',
  'home_afterword_sign',
  'home_afterword_next',
  'maintenance_enabled',
] as const;

export type SiteSettingKey = (typeof siteSettingKeys)[number];
export type SiteSettings = { [K in SiteSettingKey]: string };

/** 站点设置在 Workers KV 里的键：值是一份 { key: value } JSON。 */
export const siteSettingsKvKey = 'site-settings:v1';

/** 默认主题色。改它等于改设计基线，一般只在后台覆盖。 */
export const defaultThemeColor = '#EC88C2';

/** 首页七页的主标签（CH.0X 那一层），可在后台逐页配置。 */
export const defaultHomePageLabels = [
  'CH.01 封面',
  'CH.02 目次',
  'CH.03 四格',
  'CH.04 收藏',
  'CH.05 放送',
  'CH.06 部室',
  'CH.07 后记',
];

/**
 * 首页数据块的预设：只选含义，数值由站点统计实时算出来。
 * 顺序即后台下拉的顺序。
 */
export const homeStatPresets = [
  { key: 'latest_update', label: '最后更新', unit: '' },
  { key: 'posts', label: '文章', unit: '篇' },
  { key: 'moments', label: '动态', unit: '条' },
  { key: 'gallery', label: '展柜', unit: '件' },
  { key: 'bangumi_watching', label: '在追', unit: '部' },
  { key: 'bangumi_total', label: '追番', unit: '部' },
  { key: 'words', label: '字数', unit: '字' },
  { key: 'media', label: '媒体', unit: '件' },
  { key: 'categories', label: '分类', unit: '个' },
] as const;

export type HomeStatPreset = (typeof homeStatPresets)[number]['key'];

/** 存进 settings 的数据块定义：只存预设与可选覆盖。 */
export interface HomeStatSetting {
  preset: HomeStatPreset;
  label?: string;
  accent?: boolean;
}

/** 前台拿到的数据块：预设默认标签与单位，数值另行从统计接口取。 */
export interface HomeStatView {
  preset: HomeStatPreset;
  label: string;
  unit: string;
  accent: boolean;
}

/** 首页封面上的联系方式 / 外链（最多 6 条）。 */
export interface HomeLink {
  label: string;
  /** 旧数据里的“说明”字段，前台已不再展示，仅为兼容保留。 */
  value?: string;
  /** Iconify 图标名（icones.js.org），如 ri:rss-fill；不填时按链接自动识别。 */
  icon?: string;
  href: string;
}

export const defaultHomeStats: HomeStatSetting[] = [
  { preset: 'latest_update', accent: false },
  { preset: 'bangumi_watching', accent: true },
  { preset: 'gallery', accent: false },
];

export const defaultHomeLinks: HomeLink[] = [
  { label: '写邮件', href: 'mailto:hi@myon.studio' },
  { label: 'GitHub', href: '#' },
  { label: 'Bangumi', href: '#' },
  { label: 'RSS', href: '/articles' },
];

export const defaultSiteSettings: SiteSettings = {
  site_name: 'Myon',
  site_subtitle: '同人志',
  site_description: '一个人的二次元生活志',
  site_author: 'Myon',
  site_email: 'hi@myon.studio',
  theme_color: defaultThemeColor,
  footer_copyright: '© 2026 MYON',
  footer_tech: 'Astro · Cloudflare Workers · D1 · R2',
  footer_icp: '京ICP备 2026000000 号',
  footer_rss: '/rss.xml',
  footer_email: 'hi@myon.studio',
  default_theme: 'system',
  comments_enabled: 'true',
  home_title: '灯下的一格',
  home_lead:
    '写字、看番、存图、做点小工具。\n一个人的二次元生活志，自己画、自己印，一共七页。',
  home_page_labels: JSON.stringify(defaultHomePageLabels),
  home_stats: JSON.stringify(defaultHomeStats),
  home_links: JSON.stringify(defaultHomeLinks),
  home_cover_image: '/media/cabinet.jpg',
  home_cover_badge: '全七页 / ALL 7',
  home_cover_note: 'LIGHT ON · 只开一盏灯',
  home_end_title: '谢谢翻完',
  home_end_lead:
    '如果哪一件你也喜欢，或者只是想聊两句——下次漫展见，或者现在写邮件给我。',
  home_afterword_body: `这一册做到第七页的时候，窗外刚好天亮了。
下一册想多放一点动画截图和旅行速写，也可能什么计划都没有，想到哪画到哪。`,
  home_afterword_sign: '—— Myon，于 10 月的某个凌晨',
  home_afterword_next: 'NEXT ISSUE · ？',
  maintenance_enabled: 'false',
};

const text = (max: number) => z.string().max(max);

const homeStatSettingSchema = z.object({
  preset: z.enum(
    homeStatPresets.map((preset) => preset.key) as [
      HomeStatPreset,
      ...HomeStatPreset[],
    ],
  ),
  label: text(24).optional(),
  accent: z.boolean().optional(),
});

const homeLinkSchema = z.object({
  label: text(24),
  // 旧版本存过说明文字，校验时继续接受，输出时丢弃
  value: text(60).optional(),
  icon: z
    .string()
    .max(80)
    .regex(iconifyNamePattern, '图标需要是 Iconify 名称，例如 ri:rss-fill')
    .optional(),
  href: z
    .string()
    .max(300)
    .regex(
      /^(\/|https?:\/\/|mailto:|#)/,
      '链接需要是站内路径、http(s)、mailto 或 # 开头',
    ),
});

/** JSON 数组字符串的校验：后台用行编辑器，最终仍以字符串存 D1。 */
const jsonArrayText = <T extends z.ZodTypeAny>(item: T, maxItems: number) =>
  z
    .string()
    .max(3000)
    .refine((raw) => {
      try {
        const parsed = JSON.parse(raw);
        return (
          Array.isArray(parsed) &&
          parsed.length <= maxItems &&
          parsed.every((entry) => item.safeParse(entry).success)
        );
      } catch {
        return false;
      }
    }, '需要是 JSON 数组');

export const siteSettingsPatchSchema = z
  .object({
    site_name: text(60),
    site_subtitle: text(60),
    site_description: text(200),
    site_author: text(60),
    site_email: text(120),
    theme_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, '主题色需要是 #RRGGBB 形式的十六进制颜色'),
    footer_copyright: text(120),
    // 技术支持与备案号允许写多个 <a>，后端白名单过滤后再输出
    footer_tech: text(500),
    footer_icp: text(300),
    footer_rss: z
      .string()
      .max(300)
      .regex(
        /^(\/|https?:\/\/)/,
        'RSS 地址需要是以 / 开头的站内路径或 http(s) 链接',
      ),
    footer_email: text(120),
    default_theme: z.enum(['light', 'dark', 'system']),
    comments_enabled: z.enum(['true', 'false']),
    home_title: text(60),
    home_lead: text(240),
    home_page_labels: jsonArrayText(text(40), 7),
    home_stats: jsonArrayText(homeStatSettingSchema, 4),
    home_links: jsonArrayText(homeLinkSchema, 6),
    home_cover_image: z
      .string()
      .max(300)
      .regex(/^(\/|https?:\/\/)/, '封面图需要是站内路径或 http(s) 链接'),
    home_cover_badge: text(40),
    home_cover_note: text(60),
    home_end_title: text(60),
    home_end_lead: text(240),
    home_afterword_body: text(600),
    home_afterword_sign: text(120),
    home_afterword_next: text(80),
    maintenance_enabled: z.enum(['true', 'false']),
  })
  .partial();

export type SiteSettingsPatch = z.infer<typeof siteSettingsPatchSchema>;

/**
 * 页面 head-title 的统一格式：`页面名 · 站点名 副标题`。
 * 例：首页 · Myon 同人志。
 */
export function formatPageTitle(
  page: string,
  site: Pick<PublicSiteSettings, 'name' | 'subtitle'>,
): string {
  const tail = [site.name, site.subtitle].filter(Boolean).join(' ');
  return tail ? `${page} · ${tail}` : page;
}

/** 首页封面配置（后台可改，未配置时用默认值）。 */
export interface HomeCoverSettings {
  title: string;
  lead: string;
  /** 七页的主标签，长度固定为 7。 */
  pages: string[];
  stats: HomeStatView[];
  links: HomeLink[];
  cover: { image: string; badge: string; note: string };
}

/** 前台真正需要的那一小部分：站点信息 + 主题色 + 页脚 + 首页封面。 */
export interface PublicSiteSettings {
  /** 站点名，例如 Myon。 */
  name: string;
  /** 作者，页脚版权与后记落款使用。 */
  author: string;
  /** 维护模式：开启后前台返回维护页。 */
  maintenanceEnabled: boolean;
  /** 站点副标题（后台可改），例如 同人志。 */
  subtitle: string;
  /** 站点描述，用于 head-description / SEO。 */
  description: string;
  themeColor: string;
  footerCopyright: string;
  footerTech: string;
  footerIcp: string;
  footerRss: string;
  footerEmail: string;
  home: HomeCoverSettings;
  /** 尾页 / 后记文案。 */
  end: HomeEndSettings;
}

/** 尾页：左侧感谢语 + 后记正文。 */
export interface HomeEndSettings {
  title: string;
  lead: string;
  afterword: { body: string; sign: string; next: string };
}

function parseJsonArray<T>(raw: string, fallback: T[]): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? (parsed as T[])
      : fallback;
  } catch {
    return fallback;
  }
}

function normalizeLinks(links: HomeLink[]): HomeLink[] {
  return links.slice(0, 6).map((link) => {
    // 兼容改版前的数据：图标名曾被填在 iconHtml 字段里（只认 Iconify 名称）。
    const legacy = link as HomeLink & { iconHtml?: unknown };
    const rawIcon = isIconifyIconName(link.icon)
      ? link.icon
      : isIconifyIconName(legacy.iconHtml)
        ? legacy.iconHtml
        : '';
    const icon = rawIcon ? rawIcon.trim().toLowerCase() : '';
    return {
      label: typeof link.label === 'string' ? link.label : '',
      href: typeof link.href === 'string' ? link.href : '#',
      ...(icon ? { icon } : {}),
    };
  });
}

function normalizePageLabels(labels: string[]): string[] {
  return Array.from({ length: 7 }, (_, index) => {
    const value = labels[index];
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : (defaultHomePageLabels[index] as string);
  });
}

const presetByKey = new Map(
  homeStatPresets.map((preset) => [preset.key as string, preset]),
);
const presetByLabel = new Map<string, (typeof homeStatPresets)[number]>(
  homeStatPresets.map((preset) => [preset.label, preset]),
);

/** 兼容旧数据：按 preset、再按 label 匹配，实在不认识就退回第一个预设。 */
function normalizeStats(stats: HomeStatSetting[]): HomeStatView[] {
  return stats.slice(0, 4).map((entry) => {
    const raw = entry as HomeStatSetting & { label?: string; value?: string };
    const preset =
      presetByKey.get(raw.preset) ??
      (raw.label ? presetByLabel.get(raw.label) : undefined) ??
      homeStatPresets[0];
    const customLabel =
      typeof raw.label === 'string' &&
      raw.label.trim() &&
      raw.label !== preset.label
        ? raw.label.trim()
        : '';
    return {
      preset: preset.key,
      label: customLabel || preset.label,
      unit: preset.unit,
      accent: Boolean(raw.accent),
    };
  });
}

export function toPublicSiteSettings(
  settings: SiteSettings,
): PublicSiteSettings {
  return {
    name: settings.site_name,
    author: settings.site_author,
    maintenanceEnabled: settings.maintenance_enabled === 'true',
    subtitle: settings.site_subtitle,
    description: settings.site_description,
    themeColor: settings.theme_color,
    footerCopyright: settings.footer_copyright,
    footerTech: settings.footer_tech,
    footerIcp: settings.footer_icp,
    footerRss: settings.footer_rss,
    footerEmail: settings.footer_email,
    home: {
      title: settings.home_title,
      lead: settings.home_lead,
      pages: normalizePageLabels(
        parseJsonArray(settings.home_page_labels, defaultHomePageLabels),
      ),
      stats: normalizeStats(
        parseJsonArray(settings.home_stats, defaultHomeStats),
      ),
      links: normalizeLinks(
        parseJsonArray(settings.home_links, defaultHomeLinks),
      ),
      cover: {
        // 兼容旧设置里的 /assets/<key>：图片现在只从 R2 出。
        image: settings.home_cover_image.replace(/^\/assets\//, '/media/'),
        badge: settings.home_cover_badge,
        note: settings.home_cover_note,
      },
    },
    end: {
      title: settings.home_end_title,
      lead: settings.home_end_lead,
      afterword: {
        body: settings.home_afterword_body,
        sign: settings.home_afterword_sign,
        next: settings.home_afterword_next,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 主题色 → 一组设计变量
// ---------------------------------------------------------------------------

export interface ThemePalette {
  pink: string;
  pinkSoft: string;
  pinkWash: string;
  pinkDeep: string;
  onPink: string;
}

/** 与 public/css/v2.css 里的默认粉完全一致，保证不改配置时视觉零变化。 */
const DEFAULT_PALETTE: ThemePalette = {
  pink: '#EC88C2',
  pinkSoft: '#F6BEDC',
  pinkWash: 'rgba(236,136,194,0.18)',
  pinkDeep: '#A93B75',
  onPink: '#17131A',
};

const INK = '#17131A';
const PAPER = '#F7F3EF';

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function mix(
  from: [number, number, number],
  to: [number, number, number],
  amount: number,
) {
  return [0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * amount) as [
    number,
    number,
    number,
  ];
}

/** 底色亮就用墨色字，暗就用纸色字。 */
function readableInk(rgb: [number, number, number]): string {
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return luminance > 150 ? INK : PAPER;
}

/**
 * 由主题色推导整套粉系变量。
 * 默认色走写死的原值，其余颜色按同样的明暗关系推导。
 */
export function themePalette(themeColor: string): ThemePalette {
  const rgb = parseHex(themeColor);
  if (!rgb) return DEFAULT_PALETTE;
  if (themeColor.trim().toUpperCase() === defaultThemeColor)
    return DEFAULT_PALETTE;

  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  return {
    pink: toHex(rgb),
    pinkSoft: toHex(mix(rgb, white, 0.55)),
    pinkWash: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.18)`,
    pinkDeep: toHex(mix(rgb, black, 0.34)),
    onPink: readableInk(rgb),
  };
}

/** 与默认主题色是否一致；一致时前台不必注入覆盖样式。 */
export function isDefaultThemeColor(themeColor: string): boolean {
  return themeColor.trim().toUpperCase() === defaultThemeColor;
}
