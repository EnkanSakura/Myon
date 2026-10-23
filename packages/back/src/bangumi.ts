import type { BangumiStatus } from '@myon/shared';
import { eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { bangumiShows } from './db/schema';
import type { AppBindings } from './types';

/** Bangumi v0 API 的收藏条目（只取本站需要的字段）。 */
export interface BangumiCollectionEntry {
  subject_id: number;
  subject?: {
    name?: string;
    name_cn?: string;
    eps?: number;
  };
  /** 1 想看 · 2 看过 · 3 在看 · 4 搁置 · 5 抛弃 */
  type?: number;
  rate?: number;
  ep_status?: number;
  updated_at?: string;
}

const STATUS_BY_TYPE: Record<number, BangumiStatus> = {
  1: 'wish',
  2: 'watched',
  3: 'watching',
  4: 'paused',
  5: 'paused',
};

export interface BangumiUpsertRow {
  id: string;
  bangumiId: number;
  title: string;
  status: BangumiStatus;
  totalEps: number;
  watchedEps: number;
  score: number | null;
  updatedAt: string;
}

/** 把 Bangumi 收藏条目映射成可写库的行；纯函数，便于单测。 */
export function mapBangumiCollections(
  entries: BangumiCollectionEntry[],
): BangumiUpsertRow[] {
  const rows: BangumiUpsertRow[] = [];
  for (const entry of entries) {
    const subject = entry.subject ?? {};
    const totalEps =
      typeof subject.eps === 'number' && subject.eps > 0 ? subject.eps : 0;
    const watched =
      typeof entry.ep_status === 'number' ? Math.max(0, entry.ep_status) : 0;
    rows.push({
      id: `bg_${entry.subject_id}`,
      bangumiId: entry.subject_id,
      title: (subject.name_cn || subject.name || '未命名').slice(0, 200),
      status: STATUS_BY_TYPE[entry.type ?? 0] ?? 'wish',
      totalEps,
      watchedEps: totalEps > 0 ? Math.min(watched, totalEps) : watched,
      score:
        typeof entry.rate === 'number' && entry.rate > 0
          ? Math.round(entry.rate)
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
}

/**
 * 从 Bangumi 拉取在看/看过/想看并按 bangumi_id 写入 D1。
 * 只更新标题、状态、集数与评分；cover 与 nextAirAt 保留人工维护的值。
 */
export async function syncBangumi(env: AppBindings): Promise<SyncResult> {
  const token = env.BANGUMI_ACCESS_TOKEN;
  const username = env.BANGUMI_USERNAME;
  if (!token || !username) {
    return { ok: true, synced: 0, reason: 'not_configured' };
  }

  const entries: BangumiCollectionEntry[] = [];
  const limit = 50;
  for (let offset = 0; offset < 500; offset += limit) {
    const url = new URL(
      `https://api.bgm.tv/v0/users/${encodeURIComponent(username)}/collections`,
    );
    url.searchParams.set('subject_type', '2');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
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
      return { ok: false, synced: 0, reason: 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return { ok: false, synced: 0, reason: `bgm_${res.status}` };
    }

    const payload = (await res.json()) as { data?: BangumiCollectionEntry[] };
    const page = payload.data ?? [];
    entries.push(...page);
    if (page.length < limit) break;
  }

  const rows = mapBangumiCollections(entries);
  const db = getDb(env.DB);
  for (const row of rows) {
    await db
      .insert(bangumiShows)
      .values({
        id: row.id,
        bangumiId: row.bangumiId,
        title: row.title,
        status: row.status,
        totalEps: row.totalEps,
        watchedEps: row.watchedEps,
        score: row.score,
        updatedAt: row.updatedAt,
      })
      .onConflictDoUpdate({
        target: bangumiShows.id,
        set: {
          title: row.title,
          status: row.status,
          totalEps: row.totalEps,
          watchedEps: row.watchedEps,
          score: row.score,
          updatedAt: row.updatedAt,
        },
      });
  }

  return { ok: true, synced: rows.length };
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
