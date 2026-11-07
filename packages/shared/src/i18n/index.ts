import zhCN from './zh-CN.json';

/** 界面/站点文案的静态资源。现在只做简体中文；以后加语言时在这里登记。 */
export const supportedLocales = ['zh-CN'] as const;
export type Locale = (typeof supportedLocales)[number];
export const defaultLocale: Locale = 'zh-CN';

export type Messages = typeof zhCN;

const messages: Record<Locale, Messages> = {
  'zh-CN': zhCN,
};

/** 取语言包；未知 locale 回退默认语言。 */
export function getMessages(locale: Locale = defaultLocale): Messages {
  return messages[locale] ?? messages[defaultLocale];
}

/** 按点路径取一条文案，例如 `t('home.title')`。缺失时回退默认语言，再缺失返回 key。 */
export function t(path: string, locale: Locale = defaultLocale): string {
  const read = (source: unknown): string | null => {
    let current: unknown = source;
    for (const part of path.split('.')) {
      if (!current || typeof current !== 'object') return null;
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === 'string' ? current : null;
  };

  return read(getMessages(locale)) ?? read(messages[defaultLocale]) ?? path;
}
