import { bangumiSubjectTypes } from '@myon/shared';
import { describe, expect, it, vi } from 'vitest';
import { mapBangumiCollections, syncBangumi } from '../../src/bangumi';
import type { AppBindings } from '../../src/types';

/** 够用的 D1 桩：只记录 prepare 过的 SQL，够同步的写入路径跑完。 */
function createEnv(): AppBindings {
  const statement = () => {
    const stmt = {
      bind: () => stmt,
      first: async () => null,
      all: async () => ({ results: [], success: true, meta: {} }),
      raw: async () => [],
      run: async () => ({ success: true, meta: {} }),
    };
    return stmt;
  };

  return {
    DB: { prepare: () => statement() },
    BANGUMI_ACCESS_TOKEN: 'token',
    BANGUMI_USERNAME: 'myon',
  } as unknown as AppBindings;
}

describe('mapBangumiCollections', () => {
  it('maps a bgm collection entry into a database row', () => {
    const rows = mapBangumiCollections([
      {
        subject_id: 400602,
        subject: {
          name: 'Sousou no Frieren 2nd Season',
          name_cn: '葬送的芙莉莲 第二季',
          eps: 12,
        },
        type: 3,
        rate: 9,
        ep_status: 7,
        updated_at: '2026-10-20T19:02:00.000Z',
      },
    ]);

    expect(rows[0]).toMatchObject({
      id: 'bg_400602',
      subjectType: 'anime',
      bangumiId: 400602,
      title: '葬送的芙莉莲 第二季',
      status: 'watching',
      totalEps: 12,
      watchedEps: 7,
      score: 9,
      comment: null,
    });
  });

  it('classifies rows by the response subject_type', () => {
    const ids: Record<string, number> = {
      book: 1,
      anime: 2,
      music: 3,
      game: 4,
      real: 6,
    };
    for (const subjectType of bangumiSubjectTypes) {
      const rows = mapBangumiCollections([
        {
          subject_id: 10,
          subject_type: ids[subjectType],
          subject: { name: 'title', eps: 12 },
          type: 3,
          ep_status: 2,
        },
      ]);
      expect(rows[0]?.subjectType).toBe(subjectType);
    }
  });

  it('keeps my comment, rating and cover source', () => {
    const rows = mapBangumiCollections([
      {
        subject_id: 11,
        subject_type: 2,
        subject: {
          name: '动画',
          eps: 12,
          images: {
            large: 'https://lain.bgm.tv/pic/cover/l/aa/bb/11.jpg',
            small: 'https://lain.bgm.tv/r/200/pic/cover/l/aa/bb/11.jpg',
          },
        },
        type: 2,
        rate: 8,
        comment: '  这一季的作画很稳。  ',
      },
    ]);
    expect(rows[0]?.score).toBe(8);
    expect(rows[0]?.comment).toBe('这一季的作画很稳。');
    expect(rows[0]?.coverSource).toBe(
      'https://lain.bgm.tv/pic/cover/l/aa/bb/11.jpg',
    );
  });

  it('uses vol_status for books and values as the total', () => {
    const rows = mapBangumiCollections(
      [
        {
          subject_id: 2,
          subject: { name: '书籍', eps: 200, volumes: 10 },
          type: 2,
          vol_status: 4,
          ep_status: 120,
        },
      ],
      'book',
    );

    expect(rows[0]?.subjectType).toBe('book');
    expect(rows[0]?.totalEps).toBe(10);
    expect(rows[0]?.watchedEps).toBe(4);
  });

  it('falls back to ep_status for books without vol_status', () => {
    const rows = mapBangumiCollections(
      [
        {
          subject_id: 3,
          subject: { name: '书籍', eps: 12 },
          type: 3,
          ep_status: 5,
        },
      ],
      'book',
    );

    expect(rows[0]?.totalEps).toBe(12);
    expect(rows[0]?.watchedEps).toBe(5);
  });

  it('ignores vol_status for non-book types', () => {
    const rows = mapBangumiCollections(
      [
        {
          subject_id: 4,
          subject: { name: '动画', eps: 12 },
          type: 3,
          vol_status: 3,
          ep_status: 5,
        },
      ],
      'anime',
    );

    expect(rows[0]?.watchedEps).toBe(5);
  });

  it('falls back to the original title and clamps progress', () => {
    const rows = mapBangumiCollections([
      { subject_id: 1, subject: { name: 'Mushishi' }, type: 2, ep_status: 99 },
    ]);

    expect(rows[0]?.title).toBe('Mushishi');
    expect(rows[0]?.status).toBe('watched');
    expect(rows[0]?.totalEps).toBe(0);
    expect(rows[0]?.score).toBeNull();
  });

  it('maps unknown collection types to wish', () => {
    const rows = mapBangumiCollections([{ subject_id: 2, type: 99 }]);
    expect(rows[0]?.status).toBe('wish');
    expect(rows[0]?.title).toBe('未命名');
  });
});

describe('syncBangumi', () => {
  it('skips without credentials', async () => {
    const result = await syncBangumi({} as AppBindings);
    expect(result).toEqual({
      ok: true,
      synced: 0,
      reason: 'not_configured',
    });
  });

  it('fetches all collections once and classifies them locally', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('subject_type')).toBeNull();
      const entries = [
        {
          subject_id: 1,
          subject_type: 1,
          subject: { name: '书', volumes: 6 },
          type: 3,
          vol_status: 2,
        },
        {
          subject_id: 2,
          subject_type: 2,
          subject: { name: '番', eps: 12 },
          type: 3,
          ep_status: 3,
        },
        {
          subject_id: 3,
          subject_type: 3,
          subject: { name: '曲', eps: 10 },
          type: 2,
          ep_status: 10,
        },
        {
          subject_id: 4,
          subject_type: 4,
          subject: { name: '游戏', eps: 0 },
          type: 1,
        },
        {
          subject_id: 5,
          subject_type: 6,
          subject: { name: '剧', eps: 3 },
          type: 2,
          ep_status: 3,
        },
      ];
      return new Response(
        JSON.stringify({ data: entries, total: entries.length, limit: 100 }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await syncBangumi(createEnv());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        ok: true,
        synced: 5,
        byType: { anime: 1, book: 1, music: 1, game: 1, real: 1 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports the upstream failure without partial writes', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await syncBangumi(createEnv());
      expect(result).toEqual({ ok: false, synced: 0, reason: 'bgm_500' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
