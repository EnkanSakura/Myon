import type {
  XMediaItem,
  XMediaKind,
  XMediaVariant,
  XTweetMediaResponse,
} from '@myon/shared';

/**
 * X（Twitter）媒体下载器的纯函数。
 *
 * 真正的网络请求由 FxTwitter 公共 API（api.fxtwitter.com）完成，它返回
 * video.twimg.com / pbs.twimg.com 的直链。本模块只负责解析与归一化，
 * 因此可以完全脱离网络做单测；路由层负责实际 fetch。
 */

const TWEET_ID_PATTERN = /^\d{1,25}$/;
const STATUS_PATH_PATTERN =
  /(?:^|\/)(?:status|statuses|web\/status)\/(\d{5,25})/i;

/** 允许反向代理回浏览器的媒体域名后缀。 */
export const TWITTER_MEDIA_HOST_SUFFIXES = ['.twimg.com'] as const;

/** 只有 X 自己的图片/视频 CDN 才允许走 /tools/x/proxy。 */
export function isAllowedTwitterMediaUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return TWITTER_MEDIA_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * 接受推文 ID 或任意 X/Twitter 推文链接，返回数字 ID；解析不出时返回 null。
 */
export function parseTweetId(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) {
    return null;
  }

  if (TWEET_ID_PATTERN.test(raw)) {
    return raw;
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    const match = url.pathname.match(STATUS_PATH_PATTERN);
    if (match) {
      return match[1] ?? null;
    }
  } catch {
    // 落到下面的原始正则再试一次
  }

  const match = raw.match(STATUS_PATH_PATTERN);
  return match ? (match[1] ?? null) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function kindOf(value: unknown, fallback: XMediaKind): XMediaKind {
  return value === 'video' || value === 'gif' || value === 'photo'
    ? value
    : fallback;
}

/** 生成 "720x720 · 1:03" 这种给人看的标签。 */
function formatLabel(
  width?: number,
  height?: number,
  durationSeconds?: number,
): string | undefined {
  const parts: string[] = [];
  if (width && height) {
    parts.push(`${width}x${height}`);
  }
  if (durationSeconds && durationSeconds > 0) {
    const total = Math.round(durationSeconds);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    parts.push(
      minutes > 0
        ? `${minutes}:${String(seconds).padStart(2, '0')}`
        : `${seconds}s`,
    );
  }
  return parts.length ? parts.join(' · ') : undefined;
}

/** 图片默认拿原图：pbs.twimg.com 的 URL 加 name=orig。 */
function originalPhotoUrl(url: string): string {
  if (url.includes('?')) {
    return url;
  }
  return `${url}?name=orig`;
}

/** 收集 progressive mp4 清晰度，码率从高到低去重。 */
function collectVariants(
  entry: Record<string, unknown>,
  mainUrl?: string,
): XMediaVariant[] {
  const variants: XMediaVariant[] = [];
  const seen = new Set<string>();

  const push = (url: unknown, container: unknown, bitrate: unknown) => {
    const href = asString(url);
    if (!href || seen.has(href)) {
      return;
    }
    seen.add(href);
    const rate = asNumber(bitrate);
    variants.push({
      url: href,
      container: asString(container) ?? 'mp4',
      bitrate: rate,
    });
  };

  for (const raw of asArray(entry.formats ?? entry.variants)) {
    const format = asRecord(raw);
    if (!format) continue;
    const container =
      asString(format.container) ?? asString(format.content_type) ?? '';
    if (container && !/mp4/i.test(container)) {
      continue;
    }
    push(format.url, container || 'mp4', format.bitrate);
  }

  variants.sort((left, right) => (right.bitrate ?? 0) - (left.bitrate ?? 0));

  // status 自带的 url 通常就是最高画质的 mp4，放在第一位当默认下载。
  if (mainUrl && /\.mp4(\?|$)/i.test(mainUrl)) {
    return [
      { url: mainUrl, container: 'mp4' },
      ...variants.filter((variant) => variant.url !== mainUrl),
    ];
  }

  return variants;
}

function buildItem(
  entry: Record<string, unknown>,
  fallbackKind: XMediaKind,
  index: number,
): XMediaItem | null {
  const kind = kindOf(entry.type, fallbackKind);
  const rawUrl =
    asString(entry.url) ??
    asString(entry.media_url_https) ??
    asString(entry.media_url);
  if (!rawUrl) {
    return null;
  }

  const width = asNumber(entry.width);
  const height = asNumber(entry.height);
  const durationSeconds =
    asNumber(entry.duration) ?? asNumber(entry.duration_seconds);
  const url = kind === 'photo' ? originalPhotoUrl(rawUrl) : rawUrl;
  const variants = kind === 'photo' ? [] : collectVariants(entry, url);

  return {
    id: asString(entry.id) ?? asString(entry.id_str) ?? `${kind}-${index}`,
    kind,
    url,
    thumbnailUrl: asString(entry.thumbnail_url) ?? asString(entry.thumbnail),
    width,
    height,
    durationSeconds,
    label: formatLabel(width, height, durationSeconds),
    variants,
  };
}

function mediaEntries(
  media: Record<string, unknown>,
): Array<[Record<string, unknown>, XMediaKind]> {
  const entries: Array<[Record<string, unknown>, XMediaKind]> = [];
  const all = asArray(media.all);
  if (all.length) {
    for (const raw of all) {
      const entry = asRecord(raw);
      if (entry) entries.push([entry, kindOf(entry.type, 'photo')]);
    }
    return entries;
  }

  for (const raw of asArray(media.videos)) {
    const entry = asRecord(raw);
    if (entry) entries.push([entry, kindOf(entry.type, 'video')]);
  }
  for (const raw of asArray(media.photos)) {
    const entry = asRecord(raw);
    if (entry) entries.push([entry, 'photo']);
  }
  return entries;
}

function authorOf(source: Record<string, unknown>) {
  const author = asRecord(source.author) ?? {};
  return {
    authorName: asString(author.name) ?? asString(author.screen_name) ?? '',
    authorHandle: asString(author.screen_name) ?? '',
    authorAvatar: asString(author.avatar_url),
  };
}

function mediaOf(status: Record<string, unknown>): XMediaItem[] {
  const media = asRecord(status.media);
  if (!media) {
    return [];
  }

  const items: XMediaItem[] = [];
  for (const [entry, fallbackKind] of mediaEntries(media)) {
    const item = buildItem(entry, fallbackKind, items.length);
    if (item) {
      items.push(item);
    }
  }

  const external = asRecord(media.external);
  if (external && asString(external.url)) {
    const item = buildItem(
      { ...external, id: 'external', type: 'video' },
      'video',
      items.length,
    );
    if (item) {
      items.push(item);
    }
  }

  return items;
}

/** 归一化 api.fxtwitter.com/2/status/:id 的响应。 */
export function normalizeFxTwitterV2(
  payload: unknown,
): XTweetMediaResponse | null {
  const root = asRecord(payload);
  const status = asRecord(root?.status);
  if (!root || !status) {
    return null;
  }

  const id = asString(status.id);
  if (!id) {
    return null;
  }

  return {
    tweetId: id,
    url: asString(status.url) ?? `https://x.com/i/status/${id}`,
    ...authorOf(status),
    text: asString(status.text) ?? '',
    createdAt: asString(status.created_at),
    source: 'fxtwitter',
    media: mediaOf(status),
  };
}

/** 归一化旧版 api.fxtwitter.com/:handle/status/:id 的响应（{ code, tweet }）。 */
export function normalizeFxTwitterV1(
  payload: unknown,
  fallbackId?: string,
): XTweetMediaResponse | null {
  const root = asRecord(payload);
  const tweet = asRecord(root?.tweet);
  if (!root || !tweet) {
    return null;
  }

  const id = asString(tweet.id) ?? fallbackId;
  if (!id) {
    return null;
  }

  return {
    tweetId: id,
    url: asString(tweet.url) ?? `https://x.com/i/status/${id}`,
    ...authorOf(tweet),
    text: asString(tweet.text) ?? '',
    createdAt: asString(tweet.created_at),
    source: 'fxtwitter',
    media: mediaOf(tweet),
  };
}

/** 归一化 api.vxtwitter.com/Twitter/status/:id 的响应。 */
export function normalizeVxTwitter(
  payload: unknown,
  fallbackId?: string,
): XTweetMediaResponse | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const url = asString(root.tweetURL) ?? '';
  const id = url.match(STATUS_PATH_PATTERN)?.[1] ?? fallbackId;
  if (!id) {
    return null;
  }

  const media: XMediaItem[] = [];
  for (const raw of asArray(root.media_extended)) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const size = asRecord(entry.size) ?? {};
    const item = buildItem(
      {
        ...entry,
        width: asNumber(entry.width) ?? asNumber(size.width),
        height: asNumber(entry.height) ?? asNumber(size.height),
      },
      kindOf(entry.type, 'photo'),
      media.length,
    );
    if (item) {
      media.push(item);
    }
  }

  if (!media.length) {
    for (const raw of asArray(root.mediaURLs)) {
      const href = asString(raw);
      if (!href) continue;
      const item = buildItem(
        { url: href, type: 'photo' },
        'photo',
        media.length,
      );
      if (item) {
        media.push(item);
      }
    }
  }

  return {
    tweetId: id,
    url: url || `https://x.com/i/status/${id}`,
    authorName: asString(root.user_name) ?? '',
    authorHandle: asString(root.user_screen_name) ?? '',
    text: asString(root.text) ?? '',
    createdAt: asString(root.date),
    source: 'vxtwitter',
    media,
  };
}

/** 按去掉查询串的 URL 去重，避免同一条媒体出现多个分辨率条目。 */
export function dedupeMedia(media: XMediaItem[]): XMediaItem[] {
  const seen = new Set<string>();
  return media.filter((item) => {
    const key = item.url.split('?')[0] ?? item.url;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
