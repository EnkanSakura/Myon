import type { ComicChapter, ComicPage } from '@myon/shared';

/**
 * Champion Cross（https://championcross.jp）漫画阅读器的解析与抓取。
 *
 * 移植自旧站工具（参考社区下载器 championcross-download）：
 * - 章节页 html 里有 api 根（`data-api-domain`）与页面级 viewer id；
 * - 章节 api 会返回这一章专属的 viewer id；
 * - `/book/contentsInfo` 返回带签名的图片地址，页面按 4x4 图块顺序打乱，
 *   需要浏览器端自己还原。
 *
 * 所有函数都接受 fetchImpl，方便路由层注入 30s 超时、单测里注入桩函数。
 */

export const CHAMPIONCROSS_ORIGIN = 'https://championcross.jp';
export const CHAMPIONCROSS_API_ORIGIN = `${CHAMPIONCROSS_ORIGIN}/api`;

const EPISODE_PATH_PATTERN = /\/episodes\/([A-Za-z0-9_-]+)/;
const CATALOG_PAGE_SIZE = 30;
const CATALOG_MAX_PAGES = 20;
const PAGES_WINDOW = 60;

type JsonObject = Record<string, unknown>;

const BROWSER_HEADERS: Record<string, string> = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

export interface ChampionCrossEpisodeDetail {
  episodeId: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  /** 章节级阅读令牌；不可免费阅读时为 null。 */
  viewerId: string | null;
}

export interface ChampionCrossResolveResult {
  detail: ChampionCrossEpisodeDetail;
  chapters: ComicChapter[];
  apiOrigin: string;
}

/** 漫画代理接口允许的域名：championcross.jp 与 comici.jp（含子域）。 */
const ALLOWED_HOST_SUFFIXES = ['championcross.jp', 'comici.jp'];

export function isAllowedChampionCrossUrl(value: string): boolean {
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
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** 从 championcross 章节页地址里取章节 id。 */
export function parseEpisodeId(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(EPISODE_PATH_PATTERN);
  if (!match) {
    return null;
  }
  return match[1] ?? null;
}

/** 把用户给的地址/章节 id 规范成 championcross 章节页地址；不合法返回 null。 */
export function normalizeEpisodeUrl(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) {
    return null;
  }

  // 也接受裸的章节 id，省得用户自己拼完整地址。
  if (/^[A-Za-z0-9_-]{6,32}$/.test(raw)) {
    return `${CHAMPIONCROSS_ORIGIN}/episodes/${raw}`;
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!isAllowedChampionCrossUrl(withScheme)) {
    return null;
  }

  const episodeId = parseEpisodeId(withScheme);
  if (!episodeId) {
    return null;
  }
  return `${CHAMPIONCROSS_ORIGIN}/episodes/${episodeId}`;
}

/** 从章节页 html 的 `data-api-domain` 解析 api 根；缺失时回退默认根。 */
export function parseApiOrigin(pageUrl: string, html: string): string {
  const match = html.match(/data-api-domain="([^"]+)"/);
  const domain = match?.[1];
  if (!domain) {
    return CHAMPIONCROSS_API_ORIGIN;
  }
  if (domain.startsWith('/')) {
    try {
      return new URL(domain, pageUrl).toString().replace(/\/$/, '');
    } catch {
      return CHAMPIONCROSS_API_ORIGIN;
    }
  }
  if (domain.startsWith('http')) {
    return domain.replace(/\/$/, '');
  }
  return `https://${domain.replace(/\/$/, '')}`;
}

/** 从章节页 html 取页面级 viewer id（api 返回章节级 viewer id 之前先用它）。 */
export function parsePageViewerId(html: string): string | null {
  return html.match(/comici-viewer-id="([A-Za-z0-9_-]+)"/)?.[1] ?? null;
}

/**
 * 解析每页图块的打乱顺序。api 可能给数组，也可能给字符串化数组。
 * 不是合法的 0..n-1 排列时返回 null。
 */
export function parseScramble(value: unknown): number[] | null {
  let candidate: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      try {
        candidate = JSON.parse(trimmed.replace(/'/g, '"'));
      } catch {
        return null;
      }
    }
  }
  if (!Array.isArray(candidate)) {
    return null;
  }
  const numbers = candidate.map((entry) => Number(entry));
  if (!numbers.every((entry) => Number.isInteger(entry) && entry >= 0)) {
    return null;
  }
  const sorted = [...numbers].sort((left, right) => left - right);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== index) {
      return null;
    }
  }
  return numbers;
}

export function browserHeaders(referer: string): Record<string, string> {
  return { ...BROWSER_HEADERS, referer };
}

export function apiHeaders(referer: string): Record<string, string> {
  return {
    ...BROWSER_HEADERS,
    accept: 'application/json, text/plain, */*',
    'x-requested-with': 'XMLHttpRequest',
    referer,
  };
}

export function imageHeaders(referer: string): Record<string, string> {
  return {
    ...BROWSER_HEADERS,
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    origin: CHAMPIONCROSS_ORIGIN,
    referer,
    'sec-fetch-dest': 'image',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  referer: string,
): Promise<JsonObject> {
  const response = await fetchImpl(url, { headers: apiHeaders(referer) });
  if (!response.ok) {
    throw new Error(`championcross api ${response.status} for ${url}`);
  }
  const text = await response.text();
  try {
    return asRecord(JSON.parse(text)) ?? {};
  } catch {
    throw new Error(`championcross api returned non-json payload for ${url}`);
  }
}

function apiUrl(
  apiOrigin: string,
  path: string,
  params: Record<string, string | number>,
): string {
  const url = new URL(`${apiOrigin}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** GET /episodes/:id —— 章节信息、系列 hash 与阅读令牌。 */
export async function fetchEpisodeDetail(
  fetchImpl: typeof fetch,
  apiOrigin: string,
  episodeId: string,
  referer: string,
): Promise<ChampionCrossEpisodeDetail> {
  const payload = await fetchJson(
    fetchImpl,
    apiUrl(apiOrigin, `/episodes/${episodeId}`, {}),
    referer,
  );
  const episode = asRecord(payload.episode) ?? {};
  const content = asArray(episode.content);
  const firstContent = asRecord(content[0]);
  const viewerId = asString(firstContent?.viewerId) ?? null;
  const series = asRecord(episode.series) ?? {};
  const summary = asRecord(episode.summary) ?? {};
  return {
    episodeId,
    title: asString(summary.title) ?? asString(episode.title) ?? episodeId,
    seriesId: asString(series.id) ?? '',
    seriesTitle: asString(series.name) ?? '',
    viewerId,
  };
}

/** GET /episodes + /series/access —— 整个系列的章节列表与免费标记。 */
export async function fetchCatalog(
  fetchImpl: typeof fetch,
  apiOrigin: string,
  seriesId: string,
  referer: string,
): Promise<ComicChapter[]> {
  const chapters: ComicChapter[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const from = page * CATALOG_PAGE_SIZE + 1;
    const to = from + CATALOG_PAGE_SIZE - 1;
    const params = { seriesHash: seriesId, episodeFrom: from, episodeTo: to };
    const catalog = await fetchJson(
      fetchImpl,
      apiUrl(apiOrigin, '/episodes', params),
      referer,
    );
    const series = asRecord(catalog.series) ?? {};
    const episodes = asArray(series.episodes);

    let access = new Map<string, boolean>();
    try {
      const accessPayload = await fetchJson(
        fetchImpl,
        apiUrl(apiOrigin, '/series/access', params),
        referer,
      );
      const seriesAccess = asRecord(accessPayload.seriesAccess) ?? {};
      const list = asArray(seriesAccess.episodeAccesses);
      access = new Map(
        list
          .map((raw) => asRecord(raw))
          .filter((entry): entry is JsonObject => entry !== null)
          .map((entry) => [
            String(entry.episodeId ?? ''),
            Boolean(entry.hasAccess),
          ]),
      );
    } catch {
      access = new Map();
    }

    for (const raw of episodes) {
      const episode = asRecord(raw);
      if (!episode) continue;
      const id = asString(episode.id) ?? '';
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      chapters.push({
        id,
        title: asString(episode.title) ?? id,
        free: access.get(id) ?? false,
        current: false,
      });
    }

    if (episodes.length < CATALOG_PAGE_SIZE) {
      break;
    }
  }

  return chapters;
}

/** GET /book/contentsInfo —— 一章的签名图片地址与打乱顺序。 */
export async function fetchChapterPages(
  fetchImpl: typeof fetch,
  apiOrigin: string,
  viewerId: string,
  referer: string,
): Promise<ComicPage[]> {
  const base = { 'user-id': '0', 'comici-viewer-id': viewerId };
  const first = await fetchJson(
    fetchImpl,
    apiUrl(apiOrigin, '/book/contentsInfo', {
      ...base,
      'page-from': 0,
      'page-to': 0,
    }),
    referer,
  );
  const total = asNumber(first.totalPages) ?? 0;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('championcross returned no pages for this chapter');
  }

  const bySort = new Map<number, ComicPage>();
  const collect = (payload: JsonObject) => {
    for (const raw of asArray(payload.result)) {
      const page = asRecord(raw);
      if (!page) continue;
      const sort = asNumber(page.sort) ?? 0;
      const url = asString(page.imageUrl) ?? '';
      if (!url) continue;
      bySort.set(sort, {
        url,
        scramble: parseScramble(page.scramble),
        sort,
        width: asNumber(page.width) || undefined,
        height: asNumber(page.height) || undefined,
      });
    }
  };

  collect(first);

  for (let from = 0; from < total; from += PAGES_WINDOW) {
    const to = Math.min(from + PAGES_WINDOW - 1, total - 1);
    if (from === 0 && bySort.size >= to + 1) {
      continue;
    }
    const payload = await fetchJson(
      fetchImpl,
      apiUrl(apiOrigin, '/book/contentsInfo', {
        ...base,
        'page-from': from,
        'page-to': to,
      }),
      referer,
    );
    collect(payload);
  }

  const pages = [...bySort.values()].sort(
    (left, right) => left.sort - right.sort,
  );
  if (!pages.length) {
    throw new Error('championcross returned an empty page list');
  }
  return pages;
}

/** POST /tools/comics/championcross/resolve 的完整解析流程。 */
export async function resolveChampionCrossEpisode(
  fetchImpl: typeof fetch,
  episodeUrl: string,
): Promise<ChampionCrossResolveResult> {
  const normalized = normalizeEpisodeUrl(episodeUrl);
  if (!normalized) {
    throw new Error(
      'expected a championcross episode url (https://championcross.jp/episodes/...)',
    );
  }
  const episodeId = parseEpisodeId(normalized);
  if (!episodeId) {
    throw new Error('expected a championcross episode id');
  }

  const pageResponse = await fetchImpl(normalized, {
    headers: browserHeaders(normalized),
  });
  if (!pageResponse.ok) {
    throw new Error(`championcross page ${pageResponse.status}`);
  }
  const html = await pageResponse.text();
  const apiOrigin = parseApiOrigin(normalized, html);
  const pageViewerId = parsePageViewerId(html);

  const detail = await fetchEpisodeDetail(
    fetchImpl,
    apiOrigin,
    episodeId,
    normalized,
  );
  if (!detail.viewerId && pageViewerId) {
    detail.viewerId = pageViewerId;
  }

  let chapters: ComicChapter[] = [
    {
      id: episodeId,
      title: detail.title,
      free: Boolean(detail.viewerId),
      current: true,
    },
  ];
  if (detail.seriesId) {
    try {
      const catalog = await fetchCatalog(
        fetchImpl,
        apiOrigin,
        detail.seriesId,
        normalized,
      );
      if (catalog.length) {
        chapters = catalog.map((chapter) => ({
          ...chapter,
          free:
            chapter.free ||
            (chapter.id === episodeId && Boolean(detail.viewerId)),
          current: chapter.id === episodeId,
        }));
      }
    } catch {
      // 章节列表只是便利信息，失败时保留单章兜底
    }
  }

  return { detail, chapters, apiOrigin };
}
