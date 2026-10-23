import type { TrafficDay, TrafficSummary } from '@myon/shared';

/**
 * 访问统计：Worker 入口调用 `recordPageView` 写明细，后台总览调用 `readTraffic`
 * 读最近 30 天聚合。只统计前台 HTML 页面，不统计 API / 静态资源 / 后台页面。
 */

const TRACK_DAYS = 30;
const MAX_DAYS = 90;
const MAX_PATH_LENGTH = 300;
/** 站点按 Asia/Shanghai（UTC+8，无夏令时）切天，和后台展示口径一致。 */
const SITE_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 这些路径不算「访客打开了页面」。 */
const SKIP_PATH_PATTERNS = [
  /^\/api\//,
  /^\/_astro\//,
  /^\/assets\//,
  /^\/media\//,
  /^\/css\//,
  /^\/js\//,
  /^\/admin(?:\/|$)/,
  /^\/favicon(?:\.ico|\.svg)?$/,
  /^\/rss\.xml$/,
];

/** 只记录浏览器直接打开的 HTML 页面（GET + Accept: text/html），并排除预取。 */
export function shouldTrackRequest(request: Request): boolean {
  if (request.method !== 'GET') return false;
  const accept = request.headers.get('accept') ?? '';
  if (!accept.includes('text/html')) return false;
  // 预取 / 预渲染不重复计数
  if (request.headers.get('purpose') || request.headers.get('sec-purpose')) {
    return false;
  }
  try {
    const { pathname } = new URL(request.url);
    return !SKIP_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
  } catch {
    return false;
  }
}

/** 站点日期 YYYY-MM-DD（Asia/Shanghai，UTC+8 无夏令时）。 */
export function siteDayKey(date: Date = new Date()): string {
  return new Date(date.getTime() + SITE_OFFSET_MS).toISOString().slice(0, 10);
}

/** 当天的访客指纹：IP + UA 的 SHA-256 截断，跨天换盐，不保存 IP 原文。 */
async function visitorHash(request: Request, day: string): Promise<string> {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for') ??
    'unknown';
  const userAgent = request.headers.get('user-agent') ?? '';
  const payload = new TextEncoder().encode(`myon:${day}:${ip}:${userAgent}`);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 记录一次前台页面访问；失败只打日志，不影响页面渲染。 */
export async function recordPageView(
  db: D1Database,
  request: Request,
): Promise<void> {
  if (!shouldTrackRequest(request)) return;

  const day = siteDayKey();
  const visitor = await visitorHash(request, day);
  const { pathname } = new URL(request.url);
  const path = pathname.slice(0, MAX_PATH_LENGTH);
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      'INSERT INTO page_views (day, visitor, path, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(day, visitor, path, createdAt)
    .run();
}

interface TrafficRow {
  day: string;
  pv: number | string;
  uv: number | string;
}

function toCount(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10) || 0;
}

/** 最近 N 天访问量（含没有访问的 0 值天），按日期升序。 */
export async function readTraffic(
  db: D1Database,
  days: number = TRACK_DAYS,
): Promise<TrafficSummary> {
  const span = Math.max(1, Math.min(MAX_DAYS, Math.floor(days)));
  // 先把“现在”平移到 +8 时区，再按平移后的 UTC 字段切天，避免服务器时区影响。
  const now = new Date(Date.now() + SITE_OFFSET_MS);
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(end.getTime() - (span - 1) * 86_400_000);
  const startDay = start.toISOString().slice(0, 10);

  let rows: TrafficRow[] = [];
  try {
    const result = await db
      .prepare(
        `SELECT day, COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv
           FROM page_views
          WHERE day >= ?
          GROUP BY day
          ORDER BY day`,
      )
      .bind(startDay)
      .all<TrafficRow>();
    rows = result.results ?? [];
  } catch (error) {
    // 表还没迁移时后台不能白屏：返回全 0 即可。
    console.error('读取访问统计失败', error);
  }

  const byDay = new Map<string, TrafficDay>();
  for (const row of rows) {
    byDay.set(row.day, {
      date: row.day,
      pv: toCount(row.pv),
      uv: toCount(row.uv),
    });
  }

  const list: TrafficDay[] = [];
  for (let index = 0; index < span; index += 1) {
    const day = new Date(start.getTime() + index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    list.push(byDay.get(day) ?? { date: day, pv: 0, uv: 0 });
  }

  const totals = list.reduce(
    (sum, day) => ({
      pv: sum.pv + day.pv,
      uv: sum.uv + day.uv,
    }),
    { pv: 0, uv: 0 },
  );

  return {
    days: list,
    totals,
    today: list[list.length - 1] ?? { date: siteDayKey(), pv: 0, uv: 0 },
  };
}
