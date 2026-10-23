import { describe, expect, it } from 'vitest';
import {
  readTraffic,
  recordPageView,
  shouldTrackRequest,
  siteDayKey,
} from '../../src/traffic';

function page(path: string, init: RequestInit = {}) {
  return new Request(`https://myon.studio${path}`, {
    headers: { accept: 'text/html,application/xhtml+xml' },
    ...init,
  });
}

describe('shouldTrackRequest', () => {
  it('tracks GET html pages', () => {
    expect(shouldTrackRequest(page('/'))).toBe(true);
    expect(shouldTrackRequest(page('/articles?page=2'))).toBe(true);
    expect(shouldTrackRequest(page('/articles/hello'))).toBe(true);
  });

  it('skips non-GET, non-html, api, assets and admin', () => {
    expect(shouldTrackRequest(page('/', { method: 'POST' }))).toBe(false);
    expect(
      shouldTrackRequest(
        new Request('https://myon.studio/articles', {
          headers: { accept: 'application/json' },
        }),
      ),
    ).toBe(false);
    for (const path of [
      '/api/v1/posts',
      '/api/health',
      '/_astro/index.js',
      '/assets/cabinet.jpg',
      '/media/uploads/a.png',
      '/css/v2.css',
      '/js/site.js',
      '/admin',
      '/admin/articles',
      '/favicon.svg',
      '/rss.xml',
    ]) {
      expect(shouldTrackRequest(page(path))).toBe(false);
    }
  });

  it('does not count prefetches', () => {
    expect(
      shouldTrackRequest(
        page('/', { headers: { accept: 'text/html', purpose: 'prefetch' } }),
      ),
    ).toBe(false);
  });
});

describe('siteDayKey', () => {
  it('buckets days in Asia/Shanghai (UTC+8)', () => {
    expect(siteDayKey(new Date('2026-10-23T20:00:00+08:00'))).toBe(
      '2026-10-23',
    );
    // UTC 23:59 = 东八区次日 07:59
    expect(siteDayKey(new Date('2026-10-23T23:59:59Z'))).toBe('2026-10-24');
    expect(siteDayKey(new Date('2026-10-23T00:00:00+08:00'))).toBe(
      '2026-10-23',
    );
  });
});

/** readTraffic 只需要 prepare().bind().all() 这一条链路。 */
function trafficDb(rows: Array<{ day: string; pv: number; uv: number }>) {
  const stmt = {
    bind: () => stmt,
    all: async () => ({ results: rows, success: true, meta: {} }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

describe('recordPageView', () => {
  it('writes one row for a tracked page and nothing for skipped paths', async () => {
    const writes: unknown[][] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            writes.push([sql, ...args]);
          },
        }),
      }),
    } as unknown as D1Database;

    await recordPageView(db, page('/articles'));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toContain('INSERT INTO page_views');
    expect(writes[0]?.[3]).toBe('/articles');

    await recordPageView(db, page('/api/v1/posts'));
    await recordPageView(db, page('/admin'));
    expect(writes).toHaveLength(1);
  });
});

describe('readTraffic', () => {
  it('zero-fills missing days and sums totals', async () => {
    const threeDaysAgo = siteDayKey(new Date(Date.now() - 3 * 86_400_000));
    const traffic = await readTraffic(
      trafficDb([{ day: threeDaysAgo, pv: 12, uv: 5 }]),
      7,
    );

    expect(traffic.days).toHaveLength(7);
    expect(traffic.days[3]).toEqual({
      date: threeDaysAgo,
      pv: 12,
      uv: 5,
    });
    expect(traffic.totals).toEqual({ pv: 12, uv: 5 });
    expect(traffic.today).toEqual(traffic.days[6]);
  });

  it('returns zeros instead of throwing before the migration exists', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            throw new Error('no such table');
          },
        }),
      }),
    } as unknown as D1Database;
    const traffic = await readTraffic(db, 3);
    expect(traffic.days).toHaveLength(3);
    expect(traffic.totals).toEqual({ pv: 0, uv: 0 });
  });
});
