import { describe, expect, it } from 'vitest';
import { mapBangumiCollections } from '../../src/bangumi';

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
      bangumiId: 400602,
      title: '葬送的芙莉莲 第二季',
      status: 'watching',
      totalEps: 12,
      watchedEps: 7,
      score: 9,
    });
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
