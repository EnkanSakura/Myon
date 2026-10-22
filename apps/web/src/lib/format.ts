/** 前台展示用的日期格式化，统一成设计稿里的 2026.09.28 形式。 */

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10).replaceAll('-', '.');
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const [date = '', time = ''] = value.split('T');
  return `${date.replaceAll('-', '.')} ${time.slice(0, 5)}`.trim();
}

/** 2026.09.28 → 2026，用于文章目次的年份分组。 */
export function yearOf(value: string | null | undefined): string {
  return value ? value.slice(0, 4) : '';
}
