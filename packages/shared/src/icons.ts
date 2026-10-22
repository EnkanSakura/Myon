/** Iconify 图标（icones.js.org）：名称格式是 `前缀:图标名`，例如 ri:rss-fill。 */
export const iconifyNamePattern =
  /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[-_][a-z0-9]+)*$/i;

/** 是不是一个语法合法的 Iconify 图标名（不检查图标是否真实存在）。 */
export function isIconifyIconName(value: unknown): value is string {
  return typeof value === 'string' && iconifyNamePattern.test(value.trim());
}

/** 图标接口返回的一项：Iconify 名称 + 已过滤的内联 SVG。 */
export interface SiteIcon {
  name: string;
  svg: string;
}
