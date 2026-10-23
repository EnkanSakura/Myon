/**
 * 媒体 key → 前台 URL。
 * 统一走 /media/<key>：媒体只从 R2 读取，仓库里不再存图片。
 * 兼容旧设置里的 /assets/<key>：自动改写到 /media/<key>。
 */
export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^(https?:)?\/\//.test(key)) return key;
  if (key.startsWith('/assets/'))
    return `/media/${key.slice('/assets/'.length)}`;
  if (key.startsWith('/')) return key;
  return `/media/${key.replace(/^\/+/, '')}`;
}
