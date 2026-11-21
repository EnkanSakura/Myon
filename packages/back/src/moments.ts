import {
  type MediaImageSize,
  type MomentMediaItem,
  mediaImageSizes,
  momentMediaMaxCount,
} from '@myon/shared';

/**
 * 动态多图配图的读写辅助。
 *
 * - 新数据把数组序列化到 moments.media（JSON 文本），同时把第一张写进
 *   media_key / media_size，旧客户端继续能读到单图。
 * - 老数据没有 media：回退到 media_key / media_size，不做回填。
 * - 空数组与 null 都表示没有配图。
 */

const sizeSet = new Set<string>(mediaImageSizes);

function mediaSizeOf(value: unknown): MediaImageSize | null {
  return typeof value === 'string' && sizeSet.has(value)
    ? (value as MediaImageSize)
    : null;
}

/** 去重、丢掉空 key，并按上限截断；size 不合法时按默认（null）处理。 */
export function normalizeMomentMedia(
  items: ReadonlyArray<{ key?: unknown; size?: unknown }> | null | undefined,
): MomentMediaItem[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const result: MomentMediaItem[] = [];
  for (const item of items) {
    if (result.length >= momentMediaMaxCount) break;
    const key = typeof item?.key === 'string' ? item.key.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ key, size: mediaSizeOf(item.size) });
  }
  return result;
}

/** 解析 D1 里的 JSON 文本；损坏或空值都当没有配图。 */
export function parseMomentMedia(raw: unknown): MomentMediaItem[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeMomentMedia(parsed) : [];
  } catch {
    return [];
  }
}

/** 新数据读 media，老数据回退 mediaKey / mediaSize。 */
export function resolveMomentMedia(
  raw: unknown,
  mediaKey: string | null,
  mediaSize: MediaImageSize | null,
): MomentMediaItem[] {
  const stored = parseMomentMedia(raw);
  if (stored.length) return stored;
  return mediaKey ? [{ key: mediaKey, size: mediaSize }] : [];
}

export function serializeMomentMedia(items: MomentMediaItem[]): string | null {
  return items.length ? JSON.stringify(items) : null;
}

/** 写库时的三列：media 数组 + 第一张的旧字段。 */
export function momentMediaColumns(items: MomentMediaItem[]) {
  const first = items[0];
  return {
    media: serializeMomentMedia(items),
    mediaKey: first?.key ?? null,
    mediaSize: first?.size ?? null,
  };
}

/** 接口响应：把 media 还原成数组，同时保持旧字段指向第一张。 */
export function momentResponse<
  T extends {
    media?: string | null;
    mediaKey: string | null;
    mediaSize: MediaImageSize | null;
  },
>(row: T) {
  const media = resolveMomentMedia(row.media, row.mediaKey, row.mediaSize);
  return {
    ...row,
    media,
    mediaKey: media[0]?.key ?? null,
    mediaSize: media[0]?.size ?? null,
  };
}
