import { defaultLocale, getMessages, type Locale } from './i18n';
import staticConfig from './site.config.json';

/**
 * 不随语言变化的站点结构配置：首页展示哪些统计预设。
 * 展示文案在 i18n/zh-CN.json，这里只存 key/accent 等结构。
 * 首页联系方式（label/href/icon）仍在 KV 站点设置里，由后台编辑。
 */
export const homeStatPresetKeys = [
  'latest_update',
  'posts',
  'moments',
  'gallery',
  'bangumi_watching',
  'bangumi_total',
  'words',
  'media',
  'categories',
] as const;
export type HomeStatPreset = (typeof homeStatPresetKeys)[number];

/** 前台拿到的数据块：预设 key + 当前语言下的标签/单位，数值另行从统计接口取。 */
export interface HomeStatView {
  preset: HomeStatPreset;
  label: string;
  unit: string;
  accent: boolean;
}

/** 首页封面上的联系方式 / 外链（来自 KV 站点设置，后台可编辑）。 */
export interface HomeLink {
  label: string;
  /** Iconify 图标名（icones.js.org），如 ri:rss-fill；留空按链接自动识别。 */
  icon?: string;
  href: string;
}

interface StaticHomeStat {
  preset: HomeStatPreset;
  accent?: boolean;
}

interface StaticSiteConfig {
  home: {
    stats: StaticHomeStat[];
  };
}

const config = staticConfig as StaticSiteConfig;

/** 首页数据块：结构来自 site.config.json，标签/单位按当前语言取。 */
export function staticHomeStats(
  locale: Locale = defaultLocale,
): HomeStatView[] {
  const labels = getMessages(locale).home.stats as Record<
    string,
    { label: string; unit: string }
  >;
  return config.home.stats.slice(0, 4).map((stat) => {
    const text = labels[stat.preset] ?? {
      label: stat.preset,
      unit: '',
    };
    return {
      preset: stat.preset,
      label: text.label,
      unit: text.unit,
      accent: Boolean(stat.accent),
    };
  });
}
