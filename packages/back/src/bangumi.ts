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
  updatedAt: string;
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
): BangumiUpsertRow[] {
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
    rows.push({
      id: `bg_${entry.subject_id}`,
      subjectType,
      bangumiId: entry.subject_id,
      title: (subject.name_cn || subject.name || '未命名').slice(0, 200),
      status: STATUS_BY_TYPE[entry.type ?? 0] ?? 'wish',
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

/** D1 单条 SQL 最多 100 个绑定参数；一行 9 列，按 10 行一批写入。 */
const INSERT_CHUNK = 10;

async function upsertBangumiRows(
  env: AppBindings,
  rows: BangumiUpsertRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb(env.DB);
  for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
    const chunk = rows.slice(index, index + INSERT_CHUNK);
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
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

/**
 * 一次请求拉取全部收藏（超过 100 条才分页），按响应里的 subject_type 分类后写入 D1。
 * 只更新标题、状态、集数、评分与简评；cover 与 nextAirAt 保留人工维护的值。
 */
export async function syncBangumi(env: AppBindings): Promise<SyncResult> {
  const token = env.BANGUMI_ACCESS_TOKEN;
  const username = env.BANGUMI_USERNAME;
  if (!token || !username) {
    return { ok: true, synced: 0, reason: 'not_configured' };
  }

  const fetched = await fetchCollections(username, token);
  if (!fetched.ok) {
    return { ok: false, synced: 0, reason: fetched.reason };
  }

  const rows = mapBangumiCollections(fetched.entries);
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
      updatedAt: new Date().toISOString(),
    })
    .where(eq(bangumiShows.id, id));
  return true;
}
