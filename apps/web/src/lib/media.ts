/**
 * 媒体 key → 前台 URL。
 * 统一走 /media/<key>：Worker 先查 R2，再回退到 public/assets。
 */
export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^(https?:)?\/\//.test(key) || key.startsWith('/')) return key;
  return `/media/${key.replace(/^\/+/, '')}`;
}
