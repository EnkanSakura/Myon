import type {
  ComicPagesResponse,
  ComicPlatformListResponse,
  ComicResolveResponse,
  XTweetMediaResponse,
} from '@myon/shared';
import { Hono } from 'hono';
import {
  browserHeaders,
  fetchChapterPages,
  fetchEpisodeDetail,
  imageHeaders,
  isAllowedChampionCrossUrl,
  normalizeEpisodeUrl,
  parseApiOrigin,
  parseEpisodeId,
  parsePageViewerId,
  resolveChampionCrossEpisode,
} from '../../tools/championcross';
import {
  dedupeMedia,
  isAllowedTwitterMediaUrl,
  normalizeFxTwitterV1,
  normalizeFxTwitterV2,
  normalizeVxTwitter,
  parseTweetId,
} from '../../tools/x-media';
import type { AppBindings } from '../../types';

const UPSTREAM_TIMEOUT_MS = 30_000;
/** 中转下载的上限：200MB，超过直接拒绝，避免 Worker 被大文件拖死。 */
const MAX_PROXY_BYTES = 200 * 1024 * 1024;
const PROXY_CACHE_SECONDS = 600;

/** 漫画平台选择器：目前只移植了 Champion Cross。 */
const COMIC_PLATFORMS: ComicPlatformListResponse['platforms'] = [
  {
    id: 'championcross',
    name: 'Champion Cross',
    enabled: true,
    homepage: 'https://championcross.jp/',
  },
];

const JSON_HEADERS: Record<string, string> = {
  accept: 'application/json',
  'user-agent': 'Myon-Tools/1.0',
};

const DOWNLOAD_HEADERS: Record<string, string> = {
  accept: '*/*',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

/** 给所有上游请求加 30s 超时；流式中转除外（见 streamUpstream）。 */
function upstreamFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

function findPlatform(id: string) {
  return COMIC_PLATFORMS.find((platform) => platform.id === id);
}

/** 去掉文件名里的换行、引号与非法字符；空值回退 fallback。 */
function sanitizeFileName(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .replace(/[\r\n"\\]/g, '')
    .replace(/[/\\?%*:|<>]/g, '_')
    .trim();
  return cleaned || fallback;
}

function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const base = new URL(url).pathname.split('/').filter(Boolean).pop();
    return base ? decodeURIComponent(base) : fallback;
  } catch {
    return fallback;
  }
}

/** Content-Disposition：ASCII 兜底 + filename*（UTF-8），中文文件名不丢。 */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

/**
 * 把上游响应原样流式转发给浏览器，不把 body 读进内存。
 *
 * 注意：流式响应不能带 AbortSignal —— workerd 不允许把「创建了 signal 的
 * fetch」的 body 再转发出去（会抛错），所以这里刻意调用不带 signal 的 fetch。
 */
async function streamUpstream(
  target: string,
  headers: Record<string, string>,
  options: { fileName: string; contentTypeFallback?: string },
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(target, { headers });
  } catch {
    return jsonError('upstream_failed', 502);
  }
  if (!upstream.ok || !upstream.body) {
    return jsonError('upstream_failed', 502);
  }

  const declaredLength = Number(upstream.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROXY_BYTES) {
    return jsonError('file_too_large', 413);
  }

  // 只转发 content-type：workerd 的 fetch 已经解码过 content-encoding，
  // 再带原 content-length 会把 body 截断。
  const outHeaders = new Headers();
  outHeaders.set(
    'content-type',
    upstream.headers.get('content-type') ??
      options.contentTypeFallback ??
      'application/octet-stream',
  );
  outHeaders.set('cache-control', `public, max-age=${PROXY_CACHE_SECONDS}`);
  outHeaders.set('content-disposition', contentDisposition(options.fileName));

  return new Response(upstream.body, { status: 200, headers: outHeaders });
}

/**
 * 依次尝试 fxtwitter v2 → fxtwitter v1 → vxtwitter，任何一个成功就返回。
 * 全部失败返回 null（路由层统一成 502 tweet_resolve_failed）。
 */
async function resolveTweetMedia(
  tweetId: string,
): Promise<XTweetMediaResponse | null> {
  const attempts: Array<() => Promise<XTweetMediaResponse | null>> = [
    async () => {
      const response = await upstreamFetch(
        `https://api.fxtwitter.com/2/status/${tweetId}`,
        { headers: JSON_HEADERS },
      );
      if (!response.ok) return null;
      return normalizeFxTwitterV2(await response.json());
    },
    async () => {
      const response = await upstreamFetch(
        `https://api.fxtwitter.com/i/status/${tweetId}`,
        { headers: JSON_HEADERS },
      );
      if (!response.ok) return null;
      return normalizeFxTwitterV1(await response.json(), tweetId);
    },
    async () => {
      const response = await upstreamFetch(
        `https://api.vxtwitter.com/Twitter/status/${tweetId}`,
        { headers: JSON_HEADERS },
      );
      if (!response.ok) return null;
      return normalizeVxTwitter(await response.json(), tweetId);
    },
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result) {
        return result;
      }
    } catch {
      // 换下一个上游
    }
  }
  return null;
}

/** 读取 JSON body；解析失败返回 null（路由层统一当 400 处理）。 */
async function readJsonBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | null> {
  try {
    const payload = await c.req.json();
    return payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const toolWorkbench = new Hono<{ Bindings: AppBindings }>();

// ---------------------------------------------------------------- X 媒体
// GET /tools/x/media?url=<推文链接或 ID>：解析推文里的可下载媒体。
toolWorkbench.get('/x/media', async (c) => {
  const tweetId = parseTweetId(c.req.query('url') ?? '');
  if (!tweetId) {
    return c.json({ error: 'invalid_tweet_url' }, 400);
  }

  const resolved = await resolveTweetMedia(tweetId);
  if (!resolved) {
    return c.json({ error: 'tweet_resolve_failed' }, 502);
  }

  return c.json({
    ...resolved,
    media: dedupeMedia(resolved.media),
  } satisfies XTweetMediaResponse);
});

// GET /tools/x/proxy?url=<twimg 地址>&name=<文件名>：流式中转下载。
toolWorkbench.get('/x/proxy', async (c) => {
  const target = c.req.query('url') ?? '';
  if (!isAllowedTwitterMediaUrl(target)) {
    return c.json({ error: 'invalid_media_url' }, 400);
  }
  const fileName = sanitizeFileName(
    c.req.query('name'),
    fileNameFromUrl(target, 'x-media'),
  );
  return streamUpstream(target, DOWNLOAD_HEADERS, { fileName });
});

// ------------------------------------------------------------ 漫画平台
// GET /tools/comics/platforms：漫画下载器支持的平台列表。
toolWorkbench.get('/comics/platforms', (c) => {
  return c.json({
    platforms: COMIC_PLATFORMS,
  } satisfies ComicPlatformListResponse);
});

// POST /tools/comics/:platform/resolve：解析章节，返回系列章节列表。
toolWorkbench.post('/comics/:platform/resolve', async (c) => {
  if (!findPlatform(c.req.param('platform'))) {
    return c.json({ error: 'unknown_platform' }, 404);
  }

  const body = await readJsonBody(c);
  const rawUrl = typeof body?.url === 'string' ? body.url : '';
  if (!normalizeEpisodeUrl(rawUrl)) {
    return c.json({ error: 'invalid_episode_url' }, 400);
  }

  try {
    const result = await resolveChampionCrossEpisode(upstreamFetch, rawUrl);
    const payload: ComicResolveResponse = {
      platform: 'championcross',
      episodeId: result.detail.episodeId,
      episodeTitle: result.detail.title,
      seriesId: result.detail.seriesId || undefined,
      seriesTitle: result.detail.seriesTitle || undefined,
      chapters: result.chapters,
    };
    return c.json(payload);
  } catch (error) {
    console.error('[tools] championcross resolve failed', error);
    return c.json({ error: 'upstream_unavailable' }, 502);
  }
});

// POST /tools/comics/:platform/pages：返回一章的图片地址与打乱顺序。
toolWorkbench.post('/comics/:platform/pages', async (c) => {
  if (!findPlatform(c.req.param('platform'))) {
    return c.json({ error: 'unknown_platform' }, 404);
  }

  const body = await readJsonBody(c);
  const rawUrl = typeof body?.episodeUrl === 'string' ? body.episodeUrl : '';
  const episodeUrl = normalizeEpisodeUrl(rawUrl);
  if (!episodeUrl) {
    return c.json({ error: 'invalid_episode_url' }, 400);
  }
  const episodeId = parseEpisodeId(episodeUrl) ?? '';

  try {
    const pageResponse = await upstreamFetch(episodeUrl, {
      headers: browserHeaders(episodeUrl),
    });
    if (!pageResponse.ok) {
      return c.json({ error: 'upstream_unavailable' }, 502);
    }
    const html = await pageResponse.text();
    const apiOrigin = parseApiOrigin(episodeUrl, html);
    const detail = await fetchEpisodeDetail(
      upstreamFetch,
      apiOrigin,
      episodeId,
      episodeUrl,
    );
    const viewerId = detail.viewerId ?? parsePageViewerId(html);
    if (!viewerId) {
      return c.json({ error: 'chapter_not_free' }, 403);
    }

    const pages = await fetchChapterPages(
      upstreamFetch,
      apiOrigin,
      viewerId,
      episodeUrl,
    );
    const payload: ComicPagesResponse = {
      platform: 'championcross',
      episodeId,
      episodeTitle: detail.title,
      pages,
    };
    return c.json(payload);
  } catch (error) {
    console.error('[tools] championcross pages failed', error);
    return c.json({ error: 'upstream_unavailable' }, 502);
  }
});

// GET /tools/comics/:platform/image?url=<图片地址>&referer=<章节页>&name=<文件名>
toolWorkbench.get('/comics/:platform/image', async (c) => {
  if (!findPlatform(c.req.param('platform'))) {
    return c.json({ error: 'unknown_platform' }, 404);
  }

  const target = c.req.query('url') ?? '';
  if (!isAllowedChampionCrossUrl(target)) {
    return c.json({ error: 'invalid_image_url' }, 400);
  }
  const referer = c.req.query('referer') ?? '';
  if (!normalizeEpisodeUrl(referer)) {
    return c.json({ error: 'invalid_referer' }, 400);
  }

  const fileName = sanitizeFileName(
    c.req.query('name'),
    fileNameFromUrl(target, 'page.jpg'),
  );
  return streamUpstream(target, imageHeaders(referer), {
    fileName,
    contentTypeFallback: 'image/jpeg',
  });
});

export default toolWorkbench;
