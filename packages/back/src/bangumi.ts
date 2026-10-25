import {
  type BangumiStatus,
  type BangumiSubjectType,
  bangumiSubjectTypes,
} from '@myon/shared';
import { eq, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { bangumiShows } from './db/schema';
import type { AppBindings } from './types';

/** Bangumi v0 API 的收藏条目（只取本站需要的字段）。 */
export interface BangumiCollectionEntry {
  subject_id: number;
  subject?: {
    name?: string;
    name_cn?: string;
    /** 话数（动画 / 书籍的章节数）。 */
    eps?: number;
    /** 册数，书籍才有。 */
    volumes?: number;
    /** Bangumi 封面；large 是原图，medium/common 是缩略图。 */
    images?: {
      large?: string;
      medium?: string;
      common?: string;
      small?: string;
      grid?: string;
    };
  };
  /** 1 想看 · 2 看过 · 3 在看 · 4 搁置 · 5 抛弃 */
  type?: number;
  rate?: number;
  ep_status?: number;
  /** 书籍的已读卷数；其他类型没有这个字段。 */
  vol_status?: number;
  /** 本站保留的简评。 */
  comment?: string | null;
  /** 条目的 Bangumi 类型：1 书籍 / 2 动画 / 3 音乐 / 4 游戏 / 6 三次元。 */
  subject_type?: number;
  updated_at?: string;
}

const STATUS_BY_TYPE: Record<number, BangumiStatus> = {
  1: 'wish',
  2: 'watched',
  3: 'watching',
  4: 'paused',
  5: 'paused',
};

/** Bangumi API 的 subject_type → 本站枚举：1 书籍 / 2 动画 / 3 音乐 / 4 游戏 / 6 三次元。 */
const SUBJECT_TYPE_BY_ID: Record<number, BangumiSubjectType> = {
  1: 'book',
  2: 'anime',
  3: 'music',
  4: 'game',
  6: 'real',
};

/** Bangumi 放送日历（legacy `/calendar`）：只用来知道条目在星期几放送。 */
interface BangumiCalendarDay {
  weekday?: { id?: number; cn?: string };
  items?: Array<{ id?: number }>;
}

/** 判断查询参数里的字符串是不是本站支持的追番类型。 */
export function isBangumiSubjectType(
  value: string,
): value is BangumiSubjectType {
  return (bangumiSubjectTypes as readonly string[]).includes(value);
}

export interface BangumiUpsertRow {
  id: string;
  subjectType: BangumiSubjectType;
  bangumiId: number;
  title: string;
  status: BangumiStatus;
  totalEps: number;
  watchedEps: number;
  score: number | null;
  comment: string | null;
  /** Bangumi 原图 URL；没有封面时为空。 */
  coverSource: string | null;
  /**
   * 下一话放送时间（ISO，UTC）。
   * 只有拿到放送星期时才知道「哪一天」，时间记当天 00:00（UTC+8）；
   * undefined 表示这次同步没拿到日历数据，写入时保留数据库里的旧值。
   */
  nextAirAt?: string | null;
  updatedAt: string;
}

export interface BangumiMapOptions {
  /** Bangumi subject id → 放送星期（1 周一 … 7 周日）。整份日历都没取到时传 undefined。 */
  airWeekdays?: Map<number, number>;
  /** 计算下一话日期用的「当前时间」，测试可注入。 */
  now?: Date;
}

/** Bangumi 的星期编号（1 周一 … 7 周日）→ 与 UTC 对齐的 JS 星期（0 周日 … 6 周六）。 */
const WEEKDAY_TO_UTC_DAY: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 0,
};

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 按放送星期算「下一话」的日期：取今天或之后最近的该星期几，
 * 时间未知，统一记当天 00:00（UTC+8）。
 */
export function nextAirAtForWeekday(
  weekday: number,
  now: Date = new Date(),
): string | null {
  const utcDay = WEEKDAY_TO_UTC_DAY[weekday];
  if (utcDay === undefined) return null;
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const daysAhead = (utcDay - shanghaiNow.getUTCDay() + 7) % 7;
  const targetMidnightUtc = Date.UTC(
    shanghaiNow.getUTCFullYear(),
    shanghaiNow.getUTCMonth(),
    shanghaiNow.getUTCDate() + daysAhead,
  );
  return new Date(targetMidnightUtc - SHANGHAI_OFFSET_MS).toISOString();
}

/**
 * 把 Bangumi 收藏条目映射成可写库的行；纯函数，便于单测。
 *
 * 类型来自条目自身的 `subject_type`（兼容旧调用传入 fallback）；
 * 书籍的进度优先取 `vol_status`（已读卷数），没有时才退回 `ep_status`；
 * 其余类型只用 `ep_status`。
 */
export function mapBangumiCollections(
  entries: BangumiCollectionEntry[],
  fallbackSubjectType: BangumiSubjectType = 'anime',
  options: BangumiMapOptions = {},
): BangumiUpsertRow[] {
  const airWeekdays = options.airWeekdays;
  const now = options.now ?? new Date();
  const rows: BangumiUpsertRow[] = [];
  for (const entry of entries) {
    const subjectType =
      (entry.subject_type !== undefined
        ? SUBJECT_TYPE_BY_ID[entry.subject_type]
        : undefined) ?? fallbackSubjectType;
    const subject = entry.subject ?? {};
    const totalEps =
      subjectType === 'book' &&
      typeof subject.volumes === 'number' &&
      subject.volumes > 0
        ? subject.volumes
        : typeof subject.eps === 'number' && subject.eps > 0
          ? subject.eps
          : 0;
    const progress =
      subjectType === 'book' && typeof entry.vol_status === 'number'
        ? entry.vol_status
        : entry.ep_status;
    const watched = typeof progress === 'number' ? Math.max(0, progress) : 0;
    const status = STATUS_BY_TYPE[entry.type ?? 0] ?? 'wish';
    // 放送日程只有动画能对上 Bangumi 日历：命中的在追条目填下一话日期，
    // 其余动画条目清空旧值；日历整份缺失时保持 undefined，写入时保留数据库旧值。
    let nextAirAt: string | null | undefined;
    if (subjectType === 'anime' && airWeekdays) {
      const weekday = airWeekdays.get(entry.subject_id);
      nextAirAt =
        status === 'watching' && weekday !== undefined
          ? nextAirAtForWeekday(weekday, now)
          : null;
    }
    rows.push({
      id: `bg_${entry.subject_id}`,
      subjectType,
      bangumiId: entry.subject_id,
      title: (subject.name_cn || subject.name || '未命名').slice(0, 200),
      status,
      totalEps,
      watchedEps: totalEps > 0 ? Math.min(watched, totalEps) : watched,
      score:
        typeof entry.rate === 'number' && entry.rate > 0
          ? Math.round(entry.rate)
          : null,
      comment:
        typeof entry.comment === 'string' && entry.comment.trim() !== ''
          ? entry.comment.trim().slice(0, 500)
          : null,
      coverSource:
        subject.images?.large ||
        subject.images?.medium ||
        subject.images?.common ||
        null,
      nextAirAt,
      updatedAt: entry.updated_at || new Date().toISOString(),
    });
  }
  return rows;
}

export interface SyncResult {
  ok: boolean;
  synced: number;
  reason?: string;
  /** 本次每类同步到的条数（配置缺失时没有这一项）。 */
  byType?: Record<BangumiSubjectType, number>;
}

/** Bangumi 单页上限 100；多数账号一次请求就能拿到全部收藏。 */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const FETCH_TIMEOUT_MS = 8000;

type FetchCollectionsResult =
  | { ok: true; entries: BangumiCollectionEntry[] }
  | { ok: false; reason: string };

/**
 * 拉取一个用户的全部收藏：先不带 subject_type 请求一次，由响应里的
 * subject_type 分类；只有收藏超过 100 条时才继续翻页。
 */
async function fetchCollections(
  username: string,
  token: string,
): Promise<FetchCollectionsResult> {
  const entries: BangumiCollectionEntry[] = [];
  let offset = 0;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const url = new URL(
      `https://api.bgm.tv/v0/users/${encodeURIComponent(username)}/collections`,
    );
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'user-agent': 'myon-blog/1.0 (https://myon.top)',
        },
        signal: controller.signal,
      });
    } catch {
      // 本地直连 api.bgm.tv 常常不通（需代理）；这里如实返回失败，不抛 500
      return { ok: false, reason: 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return { ok: false, reason: `bgm_${res.status}` };
    }

    let payload: {
      data?: BangumiCollectionEntry[];
      total?: number;
      limit?: number;
    };
    try {
      payload = (await res.json()) as {
        data?: BangumiCollectionEntry[];
        total?: number;
        limit?: number;
      };
    } catch {
      return { ok: false, reason: 'bgm_invalid_payload' };
    }
    const page = payload.data ?? [];
    entries.push(...page);
    const limit = payload.limit ?? PAGE_SIZE;
    const total = payload.total ?? entries.length;
    offset += page.length;
    if (page.length === 0 || offset >= total || page.length < limit) break;
  }

  return { ok: true, entries };
}

/** 一行 11 列，按 8 行一批写入，确保不超过 D1 的 100 个绑定参数。 */
const INSERT_CHUNK = 8;

async function writeBangumiRows(
  env: AppBindings,
  rows: BangumiUpsertRow[],
  withNextAirAt: boolean,
): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb(env.DB);
  for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
    const chunk = rows.slice(index, index + INSERT_CHUNK).map((row) => {
      const { nextAirAt, ...rest } = row;
      return {
        ...rest,
        nextAirAt: withNextAirAt ? (nextAirAt ?? null) : null,
      };
    });
    await db
      .insert(bangumiShows)
      .values(chunk)
      .onConflictDoUpdate({
        target: bangumiShows.id,
        set: {
          subjectType: sql`excluded.subject_type`,
          title: sql`excluded.title`,
          status: sql`excluded.status`,
          totalEps: sql`excluded.total_eps`,
          watchedEps: sql`excluded.watched_eps`,
          score: sql`excluded.score`,
          comment: sql`excluded.comment`,
          coverSource: sql`excluded.cover_source`,
          ...(withNextAirAt ? { nextAirAt: sql`excluded.next_air_at` } : {}),
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

/**
 * 拿到放送日历的那批行才更新 next_air_at（包含「清空」）；没有日历数据时保留旧值，
 * 避免 Bangumi 日历临时失败把已有的下一话时间抹掉。
 */
async function upsertBangumiRows(
  env: AppBindings,
  rows: BangumiUpsertRow[],
): Promise<void> {
  await writeBangumiRows(
    env,
    rows.filter((row) => row.nextAirAt !== undefined),
    true,
  );
  await writeBangumiRows(
    env,
    rows.filter((row) => row.nextAirAt === undefined),
    false,
  );
}

/** Bangumi 放送日历：用来知道在追动画在星期几放送（不含具体时刻）。 */
const CALENDAR_URL = 'https://api.bgm.tv/calendar';

/**
 * 拉取 Bangumi 放送日历，得到「subject id → 放送星期」。
 * 只用于补 next_air_at 的日期；失败时返回 null，同步继续并保留数据库旧值。
 */
async function fetchAiringWeekdays(): Promise<Map<number, number> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(CALENDAR_URL, {
      headers: {
        accept: 'application/json',
        'user-agent': 'myon-blog/1.0 (https://myon.top)',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as BangumiCalendarDay[];
    if (!Array.isArray(payload)) return null;
    const weekdays = new Map<number, number>();
    for (const day of payload) {
      const weekday = day?.weekday?.id;
      if (typeof weekday !== 'number') continue;
      for (const item of day.items ?? []) {
        if (typeof item?.id === 'number') weekdays.set(item.id, weekday);
      }
    }
    return weekdays;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 一次请求拉取全部收藏（超过 100 条才分页），按响应里的 subject_type 分类后写入 D1。
 * 只保存元数据与封面源 URL；封面本身由站内 `/api/v1/bangumi/cover` 代理 + 边缘缓存提供。
 */
export async function syncBangumi(env: AppBindings): Promise<SyncResult> {
  const token = env.BANGUMI_ACCESS_TOKEN;
  const username = env.BANGUMI_USERNAME;
  if (!token || !username) {
    return { ok: true, synced: 0, reason: 'not_configured' };
  }

  const [fetched, airWeekdays] = await Promise.all([
    fetchCollections(username, token),
    fetchAiringWeekdays(),
  ]);
  if (!fetched.ok) {
    return { ok: false, synced: 0, reason: fetched.reason };
  }

  const rows = mapBangumiCollections(fetched.entries, 'anime', {
    airWeekdays: airWeekdays ?? undefined,
  });
  await upsertBangumiRows(env, rows);
  const byType: Record<BangumiSubjectType, number> = {
    anime: 0,
    book: 0,
    music: 0,
    game: 0,
    real: 0,
  };
  for (const row of rows) byType[row.subjectType] += 1;
  return { ok: true, synced: rows.length, byType };
}

/** 手动把一条记录标成“看过”，供后台快速更新进度时使用。 */
export async function markBangumiWatched(
  env: AppBindings,
  id: string,
): Promise<boolean> {
  const db = getDb(env.DB);
  const row = await db
    .select()
    .from(bangumiShows)
    .where(eq(bangumiShows.id, id))
    .get();
  if (!row) return false;
  await db
    .update(bangumiShows)
    .set({
      status: 'watched',
      watchedEps: row.totalEps,
      // 改成「看过」后不再需要下一话时间，清掉旧的放送日程。
      nextAirAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(bangumiShows.id, id));
  return true;
}
