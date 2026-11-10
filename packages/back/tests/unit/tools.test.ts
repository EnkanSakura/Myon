import { describe, expect, it, vi } from 'vitest';
import app from '../../src/app';
import {
  browserHeaders,
  CHAMPIONCROSS_API_ORIGIN,
  CHAMPIONCROSS_ORIGIN,
  fetchCatalog,
  imageHeaders,
  isAllowedChampionCrossUrl,
  normalizeEpisodeUrl,
  parseApiOrigin,
  parseEpisodeId,
  parsePageViewerId,
  parseScramble,
} from '../../src/tools/championcross';
import {
  dedupeMedia,
  isAllowedTwitterMediaUrl,
  normalizeFxTwitterV1,
  normalizeFxTwitterV2,
  normalizeVxTwitter,
  parseTweetId,
} from '../../src/tools/x-media';
import type { AppBindings } from '../../src/types';

/** 工具工作台路由不读数据库，空 env 就够了。 */
function createEnv(): AppBindings {
  return {} as unknown as AppBindings;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  });
}

const TWEET_ID = '123456789012345678';

// ---------------------------------------------------------------------------
// X 媒体纯函数
// ---------------------------------------------------------------------------

describe('parseTweetId', () => {
  it('accepts a raw numeric id', () => {
    expect(parseTweetId(TWEET_ID)).toBe(TWEET_ID);
    expect(parseTweetId(`  ${TWEET_ID}  `)).toBe(TWEET_ID);
  });

  it('extracts the id from x.com / twitter.com status urls', () => {
    for (const input of [
      `https://x.com/someone/status/${TWEET_ID}`,
      `https://x.com/someone/status/${TWEET_ID}?s=20&t=abc`,
      `https://twitter.com/someone/status/${TWEET_ID}`,
      `twitter.com/someone/statuses/${TWEET_ID}`,
      `https://x.com/i/web/status/${TWEET_ID}`,
      `x.com/someone/status/${TWEET_ID}`,
    ]) {
      expect(parseTweetId(input)).toBe(TWEET_ID);
    }
  });

  it('returns null for empty, non-tweet and malformed inputs', () => {
    for (const input of ['', '   ', 'not a link', 'https://x.com/someone']) {
      expect(parseTweetId(input)).toBeNull();
    }
    // /status/<id> 的路径本身就是 ID 来源，不要求域名必须是 x.com。
    expect(parseTweetId('https://example.com/status/1234567890')).toBe(
      '1234567890',
    );
  });
});

describe('isAllowedTwitterMediaUrl', () => {
  it('allows http(s) urls on twimg.com subdomains only', () => {
    expect(isAllowedTwitterMediaUrl('https://video.twimg.com/a/b.mp4')).toBe(
      true,
    );
    expect(isAllowedTwitterMediaUrl('https://pbs.twimg.com/media/x.jpg')).toBe(
      true,
    );
    expect(isAllowedTwitterMediaUrl('http://pbs.twimg.com/media/x.jpg')).toBe(
      true,
    );
  });

  it('rejects other hosts, schemes and malformed urls', () => {
    for (const input of [
      'https://evil.com/a.mp4',
      'https://twimg.com.evil.com/a.mp4',
      'https://notwimg.com/a.mp4',
      'ftp://pbs.twimg.com/x.jpg',
      'javascript:alert(1)',
      'not-a-url',
    ]) {
      expect(isAllowedTwitterMediaUrl(input)).toBe(false);
    }
  });
});

const fxV2Payload = {
  code: 200,
  status: {
    id: TWEET_ID,
    url: `https://x.com/someone/status/${TWEET_ID}`,
    text: '一条带媒体的推文',
    created_at: 'Sun Nov 08 12:00:00 +0000 2026',
    author: {
      name: 'Myon',
      screen_name: 'myon',
      avatar_url: 'https://pbs.twimg.com/profile_images/a.jpg',
    },
    media: {
      all: [
        {
          type: 'video',
          url: 'https://video.twimg.com/ext_tw_video/1/vid/1280x720/a.mp4',
          thumbnail_url:
            'https://pbs.twimg.com/ext_tw_video_thumb/1/img/thumb.jpg',
          width: 1280,
          height: 720,
          duration: 63,
          formats: [
            {
              url: 'https://video.twimg.com/ext_tw_video/1/vid/480x270/low.mp4',
              container: 'mp4',
              bitrate: 256000,
            },
            {
              url: 'https://video.twimg.com/ext_tw_video/1/vid/1280x720/high.mp4',
              container: 'mp4',
              bitrate: 2176000,
            },
          ],
        },
        {
          type: 'photo',
          url: 'https://pbs.twimg.com/media/photo.jpg',
          width: 1200,
          height: 800,
        },
        // 与第二条是同一张图（只是查询串不同），路由层去重后应只剩一条。
        {
          type: 'photo',
          url: 'https://pbs.twimg.com/media/photo.jpg?name=large',
          width: 1200,
          height: 800,
        },
      ],
    },
  },
};

describe('normalizeFxTwitterV2', () => {
  it('normalizes the v2 status payload', () => {
    const result = normalizeFxTwitterV2(fxV2Payload);
    expect(result).not.toBeNull();
    expect(result?.tweetId).toBe(TWEET_ID);
    expect(result?.source).toBe('fxtwitter');
    expect(result?.authorName).toBe('Myon');
    expect(result?.authorHandle).toBe('myon');
    expect(result?.text).toBe('一条带媒体的推文');

    const [video, photo] = result?.media ?? [];
    expect(video?.kind).toBe('video');
    expect(video?.label).toContain('1280x720');
    expect(video?.label).toContain('1:03');
    // 最高画质 mp4 排第一，其余按码率降序。
    expect(video?.variants[0]?.url).toBe(
      'https://video.twimg.com/ext_tw_video/1/vid/1280x720/a.mp4',
    );
    expect(video?.variants[1]?.url).toContain('high.mp4');
    expect(video?.variants[2]?.url).toContain('low.mp4');

    expect(photo?.kind).toBe('photo');
    expect(photo?.variants).toEqual([]);
    expect(photo?.url).toBe('https://pbs.twimg.com/media/photo.jpg?name=orig');
  });

  it('returns null when the payload does not describe a status', () => {
    expect(normalizeFxTwitterV2(null)).toBeNull();
    expect(normalizeFxTwitterV2({})).toBeNull();
    expect(normalizeFxTwitterV2({ status: {} })).toBeNull();
  });
});

describe('normalizeFxTwitterV1', () => {
  it('normalizes the legacy tweet payload and keeps the fallback id', () => {
    const result = normalizeFxTwitterV1(
      {
        code: 200,
        tweet: {
          text: '旧版接口',
          author: { name: '作者', screen_name: 'author' },
          media: {
            photos: [{ url: 'https://pbs.twimg.com/media/old.jpg' }],
          },
        },
      },
      TWEET_ID,
    );
    expect(result?.tweetId).toBe(TWEET_ID);
    expect(result?.source).toBe('fxtwitter');
    expect(result?.media[0]?.kind).toBe('photo');
  });

  it('returns null without a tweet object', () => {
    expect(normalizeFxTwitterV1({}, TWEET_ID)).toBeNull();
    expect(normalizeFxTwitterV1(null)).toBeNull();
  });
});

describe('normalizeVxTwitter', () => {
  it('normalizes media_extended entries', () => {
    const result = normalizeVxTwitter({
      tweetURL: `https://x.com/someone/status/${TWEET_ID}`,
      user_name: '作者',
      user_screen_name: 'author',
      text: 'vx 接口',
      date: '2026-11-08T12:00:00Z',
      media_extended: [
        {
          type: 'image',
          url: 'https://pbs.twimg.com/media/vx.jpg',
          size: { width: 640, height: 480 },
        },
      ],
    });
    expect(result?.tweetId).toBe(TWEET_ID);
    expect(result?.source).toBe('vxtwitter');
    expect(result?.authorHandle).toBe('author');
    expect(result?.media[0]?.width).toBe(640);
    expect(result?.media[0]?.label).toBe('640x480');
  });

  it('falls back to mediaURLs and the provided id', () => {
    const result = normalizeVxTwitter(
      { mediaURLs: ['https://pbs.twimg.com/media/fallback.jpg'] },
      TWEET_ID,
    );
    expect(result?.tweetId).toBe(TWEET_ID);
    expect(result?.media).toHaveLength(1);
  });

  it('returns null without an id', () => {
    expect(normalizeVxTwitter({})).toBeNull();
  });
});

describe('dedupeMedia', () => {
  it('keeps one item per url ignoring the query string', () => {
    const media = dedupeMedia([
      {
        id: 'a',
        kind: 'photo',
        url: 'https://pbs.twimg.com/media/a.jpg?name=orig',
        variants: [],
      },
      {
        id: 'b',
        kind: 'photo',
        url: 'https://pbs.twimg.com/media/a.jpg?name=large',
        variants: [],
      },
      {
        id: 'c',
        kind: 'photo',
        url: 'https://pbs.twimg.com/media/b.jpg?name=orig',
        variants: [],
      },
    ]);
    expect(media.map((item) => item.id)).toEqual(['a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// Champion Cross 纯函数
// ---------------------------------------------------------------------------

describe('parseScramble', () => {
  it('accepts arrays, stringified arrays and numeric strings', () => {
    expect(parseScramble([0, 1, 2, 3])).toEqual([0, 1, 2, 3]);
    expect(parseScramble('[0,1,2,3]')).toEqual([0, 1, 2, 3]);
    expect(parseScramble("['0','1','2','3']")).toEqual([0, 1, 2, 3]);
    expect(parseScramble(['0', '1', '2', '3'])).toEqual([0, 1, 2, 3]);
  });

  it('rejects invalid permutations and garbage', () => {
    for (const value of [
      null,
      undefined,
      '',
      'nope',
      [0, 0, 2],
      [0, 2],
      [0, 1, 3],
      [0, -1, 2],
    ]) {
      expect(parseScramble(value)).toBeNull();
    }
  });
});

describe('normalizeEpisodeUrl / parseEpisodeId', () => {
  const episodeId = 'abc123xyz';

  it('normalizes championcross and comici episode urls', () => {
    expect(
      normalizeEpisodeUrl(`https://championcross.jp/episodes/${episodeId}`),
    ).toBe(`${CHAMPIONCROSS_ORIGIN}/episodes/${episodeId}`);
    expect(normalizeEpisodeUrl(`championcross.jp/episodes/${episodeId}`)).toBe(
      `${CHAMPIONCROSS_ORIGIN}/episodes/${episodeId}`,
    );
    expect(
      normalizeEpisodeUrl(`https://comici.jp/episodes/${episodeId}?from=share`),
    ).toBe(`${CHAMPIONCROSS_ORIGIN}/episodes/${episodeId}`);
    expect(normalizeEpisodeUrl(episodeId)).toBe(
      `${CHAMPIONCROSS_ORIGIN}/episodes/${episodeId}`,
    );
    expect(
      parseEpisodeId(`https://championcross.jp/episodes/${episodeId}`),
    ).toBe(episodeId);
  });

  it('rejects foreign hosts and non-episode urls', () => {
    for (const input of [
      '',
      'not a url',
      'https://evil.com/episodes/abc123',
      'https://championcross.jp/series/abc123',
      'https://championcross.jp.evil.com/episodes/abc123',
    ]) {
      expect(normalizeEpisodeUrl(input)).toBeNull();
    }
    expect(parseEpisodeId('https://championcross.jp/series/abc123')).toBeNull();
  });
});

describe('parseApiOrigin / parsePageViewerId', () => {
  const pageUrl = `${CHAMPIONCROSS_ORIGIN}/episodes/abc123`;

  it('reads the api root from data-api-domain', () => {
    expect(
      parseApiOrigin(
        pageUrl,
        '<html data-api-domain="https://api.example.com/">',
      ),
    ).toBe('https://api.example.com');
    expect(parseApiOrigin(pageUrl, '<html data-api-domain="/api">')).toBe(
      'https://championcross.jp/api',
    );
    expect(
      parseApiOrigin(pageUrl, '<html data-api-domain="api.example.com">'),
    ).toBe('https://api.example.com');
  });

  it('falls back to the default api root without the attribute', () => {
    expect(parseApiOrigin(pageUrl, '<html></html>')).toBe(
      CHAMPIONCROSS_API_ORIGIN,
    );
  });

  it('reads the page level viewer id', () => {
    expect(
      parsePageViewerId('<html comici-viewer-id="viewer-123"></html>'),
    ).toBe('viewer-123');
    expect(parsePageViewerId('<html></html>')).toBeNull();
  });
});

describe('Champion Cross allowlist and headers', () => {
  it('allows championcross.jp / comici.jp and their subdomains', () => {
    for (const url of [
      'https://championcross.jp/api/book/contentsInfo',
      'https://api.championcross.jp/x.jpg',
      'https://comici.jp/img/a.jpg',
      'https://img.comici.jp/a.jpg',
    ]) {
      expect(isAllowedChampionCrossUrl(url)).toBe(true);
    }
    for (const url of [
      'https://evil.com/a.jpg',
      'https://championcross.jp.evil.com/a.jpg',
      'ftp://championcross.jp/a.jpg',
      'nope',
    ]) {
      expect(isAllowedChampionCrossUrl(url)).toBe(false);
    }
  });

  it('builds browser and image headers with the right referer', () => {
    const referer = 'https://championcross.jp/episodes/abc123';
    const browser = browserHeaders(referer);
    expect(browser.referer).toBe(referer);
    expect(browser['user-agent']).toContain('Mozilla/5.0');

    const image = imageHeaders(referer);
    expect(image.referer).toBe(referer);
    expect(image.origin).toBe(CHAMPIONCROSS_ORIGIN);
    expect(image['sec-fetch-dest']).toBe('image');
  });
});

describe('fetchCatalog', () => {
  it('merges catalog chapters with the access flags', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/series/access')) {
        return jsonResponse({
          seriesAccess: {
            episodeAccesses: [{ episodeId: 'e2', hasAccess: true }],
          },
        });
      }
      return jsonResponse({
        series: {
          episodes: [
            { id: 'e1', title: '第一话' },
            { id: 'e2', title: '第二话' },
          ],
        },
      });
    });

    const chapters = await fetchCatalog(
      fetchImpl as typeof fetch,
      CHAMPIONCROSS_API_ORIGIN,
      'series-1',
      `${CHAMPIONCROSS_ORIGIN}/episodes/abc123`,
    );
    expect(chapters).toEqual([
      { id: 'e1', title: '第一话', free: false, current: false },
      { id: 'e2', title: '第二话', free: true, current: false },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 路由：X 媒体解析与中转
// ---------------------------------------------------------------------------

describe('GET /api/v1/tools/x/media', () => {
  it('resolves via fxtwitter v2 and dedupes media', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(fxV2Payload),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        `/api/v1/tools/x/media?url=${encodeURIComponent(`https://x.com/someone/status/${TWEET_ID}`)}`,
        {},
        createEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        source: string;
        tweetId: string;
        media: Array<{ kind: string }>;
      };
      expect(body.source).toBe('fxtwitter');
      expect(body.tweetId).toBe(TWEET_ID);
      expect(body.media).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        `https://api.fxtwitter.com/2/status/${TWEET_ID}`,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to vxtwitter when both fxtwitter attempts fail', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.includes('vxtwitter')) {
          return jsonResponse({
            tweetURL: `https://x.com/someone/status/${TWEET_ID}`,
            user_name: '作者',
            user_screen_name: 'author',
            text: 'vx',
            media_extended: [
              {
                type: 'image',
                url: 'https://pbs.twimg.com/media/vx.jpg',
                size: { width: 640, height: 480 },
              },
            ],
          });
        }
        return jsonResponse({}, 404);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        `/api/v1/tools/x/media?url=${TWEET_ID}`,
        {},
        createEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { source: string };
      expect(body.source).toBe('vxtwitter');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns 502 when every upstream fails', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/api/v1/tools/x/media?url=${TWEET_ID}`,
        {},
        createEnv(),
      );
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'tweet_resolve_failed' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      errorSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('rejects an invalid tweet url before calling upstream', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        '/api/v1/tools/x/media?url=not-a-tweet',
        {},
        createEnv(),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_tweet_url' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('GET /api/v1/tools/x/proxy', () => {
  const mediaUrl = 'https://pbs.twimg.com/media/download.jpg';

  it('streams allowed twimg media as an attachment', async () => {
    const payload = new TextEncoder().encode('fake-image-bytes');
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(payload, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': String(payload.byteLength),
          },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        `/api/v1/tools/x/proxy?url=${encodeURIComponent(mediaUrl)}&name=${encodeURIComponent('测试 图.jpg')}`,
        {},
        createEnv(),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect(res.headers.get('cache-control')).toBe('public, max-age=600');
      const disposition = res.headers.get('content-disposition') ?? '';
      expect(disposition).toContain('attachment;');
      expect(disposition).toContain("filename*=UTF-8''");
      expect(new TextDecoder().decode(await res.arrayBuffer())).toBe(
        'fake-image-bytes',
      );

      // 流式中转不能带 AbortSignal（workerd 限制）。
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init?.signal).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects non-twimg urls and upstream failures', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const invalid = await app.request(
        `/api/v1/tools/x/proxy?url=${encodeURIComponent('https://evil.com/a.jpg')}`,
        {},
        createEnv(),
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: 'invalid_media_url' });
      expect(fetchMock).not.toHaveBeenCalled();

      const failed = await app.request(
        `/api/v1/tools/x/proxy?url=${encodeURIComponent(mediaUrl)}`,
        {},
        createEnv(),
      );
      expect(failed.status).toBe(502);
      expect(await failed.json()).toEqual({ error: 'upstream_failed' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects files larger than 200MB', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('big', {
          status: 200,
          headers: {
            'content-type': 'video/mp4',
            'content-length': String(200 * 1024 * 1024 + 1),
          },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        `/api/v1/tools/x/proxy?url=${encodeURIComponent(mediaUrl)}`,
        {},
        createEnv(),
      );
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'file_too_large' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// 路由：漫画下载
// ---------------------------------------------------------------------------

describe('GET /api/v1/tools/comics/platforms', () => {
  it('lists championcross only', async () => {
    const res = await app.request(
      '/api/v1/tools/comics/platforms',
      {},
      createEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      platforms: [
        {
          id: 'championcross',
          name: 'Champion Cross',
          enabled: true,
          homepage: 'https://championcross.jp/',
        },
      ],
    });
  });
});

describe('POST /api/v1/tools/comics/:platform/resolve', () => {
  const resolvePath = '/api/v1/tools/comics/championcross/resolve';

  it('returns 404 for unknown platforms', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        '/api/v1/tools/comics/unknown/resolve',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: 'https://championcross.jp/episodes/abc123',
          }),
        },
        createEnv(),
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'unknown_platform' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects invalid episode urls', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    try {
      for (const url of ['https://evil.com/episodes/abc123', '', undefined]) {
        const res = await app.request(
          resolvePath,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url }),
          },
          createEnv(),
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'invalid_episode_url' });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves an episode with its chapter catalog', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://championcross.jp/episodes/abc123') {
        return textResponse('<html><body>page</body></html>');
      }
      if (url.includes('/api/episodes/abc123')) {
        return jsonResponse({
          episode: {
            summary: { title: '第 1 话' },
            series: { id: 'series-1', name: '作品 A' },
            content: [{ viewerId: 'viewer-1' }],
          },
        });
      }
      if (url.includes('/api/series/access')) {
        return jsonResponse({
          seriesAccess: {
            episodeAccesses: [{ episodeId: 'def456', hasAccess: true }],
          },
        });
      }
      if (url.includes('/api/episodes?')) {
        return jsonResponse({
          series: {
            episodes: [
              { id: 'abc123', title: '第 1 话' },
              { id: 'def456', title: '第 2 话' },
            ],
          },
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        resolvePath,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: 'https://championcross.jp/episodes/abc123',
          }),
        },
        createEnv(),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        platform: 'championcross',
        episodeId: 'abc123',
        episodeTitle: '第 1 话',
        seriesId: 'series-1',
        seriesTitle: '作品 A',
        chapters: [
          { id: 'abc123', title: '第 1 话', free: true, current: true },
          { id: 'def456', title: '第 2 话', free: true, current: false },
        ],
      });
      // 章节页 + 章节 api + 系列目录 + 权限接口
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns 502 when the upstream page fails', async () => {
    const fetchMock = vi.fn(
      async () => new Response('blocked', { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        resolvePath,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: 'https://championcross.jp/episodes/abc123',
          }),
        },
        createEnv(),
      );
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'upstream_unavailable' });
    } finally {
      errorSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('POST /api/v1/tools/comics/:platform/pages', () => {
  const pagesPath = '/api/v1/tools/comics/championcross/pages';

  it('returns pages with scramble orders', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://championcross.jp/episodes/abc123') {
        return textResponse('<html><body>page</body></html>');
      }
      if (url.includes('/api/episodes/abc123')) {
        return jsonResponse({
          episode: { title: '第 1 话', content: [{ viewerId: 'viewer-1' }] },
        });
      }
      if (url.includes('/book/contentsInfo')) {
        return jsonResponse({
          totalPages: 2,
          result: [
            {
              sort: 0,
              imageUrl: 'https://championcross.jp/img/0.jpg',
              scramble: [0, 1, 2, 3],
            },
            {
              sort: 1,
              imageUrl: 'https://championcross.jp/img/1.jpg',
              scramble: '[3,2,1,0]',
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        pagesPath,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            episodeUrl: 'https://championcross.jp/episodes/abc123',
          }),
        },
        createEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        platform: string;
        episodeId: string;
        episodeTitle: string;
        pages: Array<{ url: string; scramble: number[]; sort: number }>;
      };
      expect(body.platform).toBe('championcross');
      expect(body.episodeId).toBe('abc123');
      expect(body.episodeTitle).toBe('第 1 话');
      expect(body.pages).toEqual([
        {
          url: 'https://championcross.jp/img/0.jpg',
          scramble: [0, 1, 2, 3],
          sort: 0,
        },
        {
          url: 'https://championcross.jp/img/1.jpg',
          scramble: [3, 2, 1, 0],
          sort: 1,
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns 403 when the chapter is not free', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://championcross.jp/episodes/abc123') {
        return textResponse('<html><body>page</body></html>');
      }
      return jsonResponse({ episode: { title: '第 1 话', content: [] } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        pagesPath,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            episodeUrl: 'https://championcross.jp/episodes/abc123',
          }),
        },
        createEnv(),
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'chapter_not_free' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects invalid episode urls before calling upstream', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        pagesPath,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ episodeUrl: 'https://evil.com/a' }),
        },
        createEnv(),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_episode_url' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('GET /api/v1/tools/comics/:platform/image', () => {
  const imagePath = '/api/v1/tools/comics/championcross/image';
  const imageUrl = 'https://championcross.jp/api/img/page-1.jpg';
  const referer = 'https://championcross.jp/episodes/abc123';

  it('streams an allowed image with the comic headers', async () => {
    const payload = new TextEncoder().encode('page-bytes');
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(payload, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await app.request(
        `${imagePath}?url=${encodeURIComponent(imageUrl)}&referer=${encodeURIComponent(referer)}&name=page-1.jpg`,
        {},
        createEnv(),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect(res.headers.get('cache-control')).toBe('public, max-age=600');
      expect(res.headers.get('content-disposition')).toContain('attachment;');

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = init?.headers as Record<string, string>;
      expect(headers.origin).toBe(CHAMPIONCROSS_ORIGIN);
      expect(headers.referer).toBe(referer);
      expect(init?.signal).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects foreign image hosts and referers', async () => {
    const fetchMock = vi.fn(async () => new Response('x', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const badUrl = await app.request(
        `${imagePath}?url=${encodeURIComponent('https://evil.com/a.jpg')}&referer=${encodeURIComponent(referer)}`,
        {},
        createEnv(),
      );
      expect(badUrl.status).toBe(400);
      expect(await badUrl.json()).toEqual({ error: 'invalid_image_url' });

      const badReferer = await app.request(
        `${imagePath}?url=${encodeURIComponent(imageUrl)}&referer=${encodeURIComponent('https://evil.com/episodes/abc123')}`,
        {},
        createEnv(),
      );
      expect(badReferer.status).toBe(400);
      expect(await badReferer.json()).toEqual({ error: 'invalid_referer' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns 404 for an unknown platform', async () => {
    const res = await app.request(
      `/api/v1/tools/comics/unknown/image?url=${encodeURIComponent(imageUrl)}&referer=${encodeURIComponent(referer)}`,
      {},
      createEnv(),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_platform' });
  });
});
