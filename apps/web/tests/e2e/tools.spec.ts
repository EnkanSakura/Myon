import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// 工具页 /tools 与 /tools/<slug> 都来自 D1（GET /api/v1/tools，只含启用项）。
// 三个工作台移植自旧站：X 媒体下载、LC 计算器、漫画下载；外部服务全部在
// 浏览器侧用 route 拦截模拟，测试不依赖真实网络。
type PublicTool = {
  slug: string;
  name: string;
  toolKey: string | null;
  href: string | null;
  enabled: boolean;
};

/** 1x1 透明 PNG：给图片中转 / 漫画页面 mock 用。 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const X_RESULT = {
  tweetId: '1899108676943684041',
  url: 'https://x.com/SpaceX/status/1899108676943684041',
  authorName: 'SpaceX',
  authorHandle: 'SpaceX',
  authorAvatar:
    'https://pbs.twimg.com/profile_images/1697749409851985920/HbrI04tM_200x200.jpg',
  text: 'Static fire test of the vehicle that will fly Crew-10',
  createdAt: 'Mon Mar 10 14:42:46 +0000 2025',
  source: 'fxtwitter',
  media: [
    {
      id: 'photo_1',
      kind: 'photo',
      url: 'https://pbs.twimg.com/media/Glr9Rm8WIAAQLK-.jpg?name=orig',
      width: 1366,
      height: 2048,
      label: '1366x2048',
      variants: [],
    },
    {
      id: 'video_1',
      kind: 'video',
      url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/main.mp4',
      thumbnailUrl:
        'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/thumb.jpg',
      width: 1280,
      height: 720,
      durationSeconds: 60,
      label: '1280x720 · 1:00',
      variants: [
        {
          url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/hi.mp4',
          container: 'mp4',
          bitrate: 2176000,
        },
        {
          url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/lo.mp4',
          container: 'mp4',
          bitrate: 832000,
        },
      ],
    },
  ],
};

const COMIC_PLATFORMS = {
  platforms: [
    {
      id: 'championcross',
      name: 'Champion Cross',
      enabled: true,
      homepage: 'https://championcross.jp/',
    },
  ],
};

const COMIC_RESOLVE = {
  platform: 'championcross',
  episodeId: '822ef81b73d8c',
  episodeTitle: '第1话',
  seriesId: 'series_1',
  seriesTitle: 'もずく、ウォーキング！',
  chapters: [
    { id: '822ef81b73d8c', title: '第1话', free: true, current: true },
    { id: 'chapter_2', title: '第2话', free: true, current: false },
    { id: 'chapter_3', title: '第3话', free: false, current: false },
  ],
};

const COMIC_PAGES = {
  platform: 'championcross',
  episodeId: '822ef81b73d8c',
  episodeTitle: '第1话',
  pages: [
    { url: 'https://championcross.jp/cdn/page-1.png', scramble: null, sort: 0 },
    {
      url: 'https://championcross.jp/cdn/page-2.png',
      scramble: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      sort: 1,
    },
  ],
};

/** 读取 store 模式 ZIP 的条目名：本地文件头按顺序紧排，逐个跳过即可。 */
function readZipNames(buffer: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString('utf8');
    names.push(name);
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

test.describe('工具页与真实数据', () => {
  test('/api/v1/tools 返回三个移植工具，工具页只列启用项', async ({
    request,
  }) => {
    const res = await request.get('/api/v1/tools');
    expect(res.status()).toBe(200);
    const { items } = (await res.json()) as { items: PublicTool[] };
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.slug.length).toBeGreaterThanOrEqual(2);
      expect(item.slug.length).toBeLessThanOrEqual(40);
      expect(item.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(item.enabled).toBe(true);
    }

    // 旧工具已整体移除，只剩从旧站移植的三个工作台（本地 seed 里漫画为启用态）。
    expect(items.map((item) => item.toolKey).sort()).toEqual([
      'comic-downloader',
      'lc-calculator',
      'x-downloader',
    ]);
  });

  test('前台 /tools 列表与 API 一致，每项链接到 /tools/<slug>', async ({
    page,
    request,
  }) => {
    const res = await request.get('/api/v1/tools');
    expect(res.status()).toBe(200);
    const { items } = (await res.json()) as { items: PublicTool[] };
    expect(items.length).toBeGreaterThan(0);

    await page.goto('/tools');
    await expect(page.locator('.tool')).toHaveCount(items.length);

    for (const item of items) {
      await expect(
        page.locator(`.tool[href="/tools/${item.slug}"]`),
      ).toHaveCount(1);
    }
    for (const item of items.slice(0, 3)) {
      await expect(
        page.locator('.tool').filter({ hasText: item.name }).first(),
      ).toBeVisible();
    }

    // 旧工具（时间戳 / 图片压缩 / Markdown 预览…）不应再出现
    const body = page.locator('body');
    await expect(body).not.toContainText('时间戳转换');
    await expect(body).not.toContainText('Markdown 预览');
    await expect(body).not.toContainText('本月调用');
    await expect(body).not.toContainText('8,367');
  });

  test('LC 计算器：任意两个量求第三个，并可把结果填回输入框', async ({
    page,
  }) => {
    const res = await page.goto('/tools/lc-calculator');
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toContainText('LC 计算器');
    await expect(page.locator('#lcTool')).toBeVisible();

    // L=10µH、C=100pF → f ≈ 5.03292 MHz
    await page.locator('#lcL').fill('10');
    await page.locator('#lcC').fill('100');
    await expect(page.locator('#lcResult')).toBeVisible();
    await expect(page.locator('#lcResultText')).toContainText('5.03292');
    await expect(page.locator('#lcResultText')).toContainText('MHz');

    // 重算：结果填回频率，电感与电容清空
    await page.locator('#lcRecalc').click();
    await expect(page.locator('#lcF')).toHaveValue('5.03292');
    await expect(page.locator('#lcL')).toHaveValue('');
    await expect(page.locator('#lcC')).toHaveValue('');
    await expect(page.locator('#lcResult')).toBeHidden();

    // 频率匹配：C₁=100pF、f₁=5MHz、f₂=10MHz → C₂=25pF
    await page.locator('#lcMatchC').fill('100');
    await page.locator('#lcMatchFrom').fill('5');
    await page.locator('#lcMatchTo').fill('10');
    await expect(page.locator('#lcMatchResult')).toBeVisible();
    await expect(page.locator('#lcMatchText')).toHaveText('25 pF');
  });

  test('X 下载：解析推文并渲染媒体卡与中转下载链接', async ({ page }) => {
    const mediaRequests: string[] = [];
    await page.route('**/api/v1/tools/x/media**', async (route) => {
      mediaRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(X_RESULT),
      });
    });
    await page.route('**/api/v1/tools/x/proxy**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }),
    );

    await page.goto('/tools/x-downloader');
    await expect(page.locator('h1').first()).toContainText(
      'X 视频 / GIF 下载器',
    );
    await page
      .locator('#xUrl')
      .fill('https://x.com/SpaceX/status/1899108676943684041');
    await page.locator('#xResolve').click();

    await expect(page.locator('#xResult')).toBeVisible();
    await expect(page.locator('#xName')).toHaveText('SpaceX');
    await expect(page.locator('#xHandle')).toHaveText('@SpaceX');
    await expect(page.locator('#xMedia .x-card')).toHaveCount(2);

    const firstCard = page.locator('#xMedia .x-card').first();
    const proxyHref = await firstCard
      .locator('a[download]')
      .getAttribute('href');
    expect(proxyHref).toContain('/api/v1/tools/x/proxy?url=');
    expect(proxyHref).toContain(
      encodeURIComponent(
        'https://pbs.twimg.com/media/Glr9Rm8WIAAQLK-.jpg?name=orig',
      ),
    );
    expect(proxyHref).toContain('name=1899108676943684041_1.jpg');

    // 视频卡有多个清晰度时展开 variants
    const videoCard = page.locator('#xMedia .x-card').nth(1);
    await videoCard.locator('.x-variants summary').click();
    await expect(videoCard.locator('.x-variants li')).toHaveCount(2);
    await expect(videoCard.locator('.x-variants li').first()).toContainText(
      '2176 kbps',
    );
    await expect(videoCard.locator('.x-variants li').nth(1)).toContainText(
      '832 kbps',
    );

    const requested = new URL(mediaRequests[0] ?? 'http://localhost/');
    expect(requested.searchParams.get('url')).toBe(
      'https://x.com/SpaceX/status/1899108676943684041',
    );
  });

  test('X 下载：无效链接显示中文错误提示', async ({ page }) => {
    await page.route('**/api/v1/tools/x/media**', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_tweet_url' }),
      }),
    );

    await page.goto('/tools/x-downloader');
    await page.locator('#xUrl').fill('not-a-tweet');
    await page.locator('#xResolve').click();
    await expect(page.locator('#xError')).toBeVisible();
    await expect(page.locator('#xErrorText')).toHaveText(
      '链接格式不正确，请粘贴完整的推文链接',
    );
    await expect(page.locator('#xResult')).toBeHidden();
  });

  test('工具 API：参数校验与漫画平台列表', async ({ request }) => {
    const invalidTweet = await request.get(
      '/api/v1/tools/x/media?url=not-a-tweet',
    );
    expect(invalidTweet.status()).toBe(400);
    expect((await invalidTweet.json()).error).toBe('invalid_tweet_url');

    const invalidProxy = await request.get(
      '/api/v1/tools/x/proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg',
    );
    expect(invalidProxy.status()).toBe(400);
    expect((await invalidProxy.json()).error).toBe('invalid_media_url');

    const platforms = await request.get('/api/v1/tools/comics/platforms');
    expect(platforms.status()).toBe(200);
    const platformBody = (await platforms.json()) as {
      platforms: { id: string; enabled: boolean }[];
    };
    expect(platformBody.platforms[0]?.id).toBe('championcross');

    const invalidResolve = await request.post(
      '/api/v1/tools/comics/championcross/resolve',
      {
        data: { url: 'https://example.com/not-a-championcross-url' },
      },
    );
    expect(invalidResolve.status()).toBe(400);
    expect((await invalidResolve.json()).error).toBe('invalid_episode_url');

    const unknownPlatform = await request.post(
      '/api/v1/tools/comics/unknown/resolve',
      {
        data: { url: 'https://championcross.jp/episodes/822ef81b73d8c' },
      },
    );
    expect(unknownPlatform.status()).toBe(404);
  });

  test('漫画下载：解析章节、筛选免费章节并打包成 ZIP', async ({ page }) => {
    await page.route('**/api/v1/tools/comics/platforms', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(COMIC_PLATFORMS),
      }),
    );
    await page.route('**/api/v1/tools/comics/championcross/resolve', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(COMIC_RESOLVE),
      }),
    );
    await page.route('**/api/v1/tools/comics/championcross/pages', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(COMIC_PAGES),
      }),
    );
    await page.route('**/api/v1/tools/comics/championcross/image**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }),
    );

    await page.goto('/tools/comic-downloader');
    await expect(page.locator('h1').first()).toContainText('漫画下载');
    await page
      .locator('#comicUrl')
      .fill('https://championcross.jp/episodes/822ef81b73d8c/2');
    await page.locator('#comicResolve').click();

    await expect(page.locator('#comicResult')).toBeVisible();
    await expect(page.locator('#comicSeries')).toHaveText(
      'もずく、ウォーキング！',
    );
    await expect(page.locator('.comic-chapter')).toHaveCount(3);
    await expect(page.locator('#comicSelected')).toHaveText('已选 1 / 3 话');

    // 付费章节不可选
    await expect(
      page.locator('.comic-chapter').nth(2).locator('.cc-box'),
    ).toBeDisabled();

    // 选择全部免费章节（2 话）
    await page.locator('.comic-preset[data-preset="all"]').click();
    await expect(page.locator('#comicSelected')).toHaveText('已选 2 / 3 话');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#comicDownload').click(),
    ]);
    expect(download.suggestedFilename()).toBe('もずく、ウォーキング！.zip');

    const filePath = await download.path();
    if (!filePath) throw new Error('漫画 ZIP 下载失败：没有拿到本地文件路径');
    const names = readZipNames(readFileSync(filePath));
    expect(names).toHaveLength(4);
    expect(names).toContain('もずく、ウォーキング！/第1话/image_1.png');
    expect(names).toContain('もずく、ウォーキング！/第1话/image_2.jpg');
    expect(names).toContain('もずく、ウォーキング！/第2话/image_1.png');
    await expect(page.locator('#comicDone')).toBeVisible();
  });

  test('漫画下载：不可免费阅读的章节显示明确错误', async ({ page }) => {
    await page.route('**/api/v1/tools/comics/platforms', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(COMIC_PLATFORMS),
      }),
    );
    await page.route('**/api/v1/tools/comics/championcross/resolve', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'chapter_not_free' }),
      }),
    );

    await page.goto('/tools/comic-downloader');
    await page
      .locator('#comicUrl')
      .fill('https://championcross.jp/episodes/822ef81b73d8c/2');
    await page.locator('#comicResolve').click();
    await expect(page.locator('#comicError')).toBeVisible();
    await expect(page.locator('#comicErrorText')).toContainText(
      '该章节当前不可免费阅读',
    );
    await expect(page.locator('#comicResult')).toBeHidden();
  });

  test('不存在的工具返回 404 空态', async ({ page }) => {
    const res = await page.goto('/tools/no-such-tool');
    expect(res?.status()).toBe(404);
    await expect(page.locator('h1')).toContainText('工具不存在');
    await expect(page.locator('a[href="/tools"]').first()).toBeVisible();
  });

  test('后台总览不再展示设计稿假数据', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('h1').first()).toContainText('总览');
    const body = page.locator('body');
    await expect(body).not.toContainText('示例数据');
    await expect(body).not.toContainText('占位数据');
    await expect(body).not.toContainText('24,318');
    await expect(body).not.toContainText('38 MB');
    await expect(body).not.toContainText('2a1f3c9');
  });

  test('traffic 接口返回真实结构', async ({ request }) => {
    const trafficRes = await request.get('/api/v1/traffic');
    expect(trafficRes.status()).toBe(200);
    const traffic = (await trafficRes.json()) as {
      days: { date: string; pv: number; uv: number }[];
      totals: { pv: number; uv: number };
      today: { date: string; pv: number; uv: number };
    };
    expect(traffic.days).toHaveLength(30);
    expect(traffic.totals.pv).toBeGreaterThanOrEqual(0);
    expect(traffic.days[29]).toEqual(traffic.today);
  });
});
