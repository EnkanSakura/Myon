import { expect, test } from '@playwright/test';

test('七页封面、翻页与深浅色切换', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.p1 .copy h1')).toContainText('灯下的一格');
  // 关于卡由服务端渲染；内容来自 D1（可能是任意真实文案），这里只校验有结构化内容。
  expect(await page.locator('#aboutBody > *').count()).toBeGreaterThan(0);

  await page.locator('.pager button').nth(1).click();
  await expect(page.locator('#pageSticker')).toContainText('PAGE 02');

  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('.theme-btn').click();
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-theme',
    before ?? 'light',
  );
});

test('尾页后记文案来自后台设置', async ({ page }) => {
  await page.goto('/');
  const end = page.locator('.p7');
  await expect(end.locator('h2')).toContainText('谢谢翻完');
  await expect(end.locator('.after')).toContainText('如果哪一件你也喜欢');
  await expect(end.locator('.letter')).toContainText('第七页');
  await expect(end.locator('.thank')).toContainText('Myon');
});

test('第 2 页最近文章来自 D1', async ({ page }) => {
  await page.goto('/');
  const rows = page.locator('.p2 .rows .r');
  const count = await rows.count();
  // 后台 CRUD 用例会并行增删文章，这里只校验「真实文章列表」的结构，不绑定瞬时条数。
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(3);
  for (let i = 0; i < count; i += 1) {
    await expect(rows.nth(i)).toHaveAttribute('href', /^\/articles\/[^/]+$/);
  }
  await expect(page.locator('.p2 .home-empty')).toHaveCount(0);
});

test('第 3–6 页展示 D1 真实数据，空态不再引用封面图', async ({
  page,
  request,
}) => {
  const stats = (await (await request.get('/api/v1/stats')).json()) as {
    gallery: { displayed: number };
  };
  const gallery = (await (
    await request.get('/api/v1/gallery?limit=3')
  ).json()) as {
    items: { mediaKey: string | null }[];
  };
  const bangumi = (await (
    await request.get('/api/v1/bangumi?type=anime&limit=100')
  ).json()) as {
    items: {
      title: string;
      status: string;
      nextAirAt: string | null;
      updatedAt: string;
    }[];
  };
  const watching = bangumi.items.filter((item) => item.status === 'watching');

  // P3 动态：计数是真实数字，面板只渲染 1–4 条（后台 CRUD 会并行增删，不绑定瞬时条数）
  await page.goto('/?p=2');
  await expect(page.locator('.p3 .count b')).toHaveText(/^\d+$/);
  const momentPanels = await page.locator('.p3 .mini-panel').count();
  expect(momentPanels).toBeGreaterThan(0);
  expect(momentPanels).toBeLessThanOrEqual(4);

  // P4 展柜：件数与拼贴图来自 D1 已展示的藏品
  await page.goto('/?p=3');
  await expect(page.locator('.p4 .big b')).toHaveText(
    String(stats.gallery.displayed),
  );
  await expect(page.locator('.p4 .collage .frame')).toHaveCount(
    gallery.items.filter((item) => item.mediaKey).length,
  );

  // P5 追番：在追卡片与放送表来自 Bangumi 同步数据；有放送日期的排在前面
  await page.goto('/?p=4');
  await expect(page.locator('.p5 .program')).toHaveCount(
    Math.min(3, watching.length),
  );
  const orderedWatching = watching.slice().sort((a, b) => {
    if (!!a.nextAirAt !== !!b.nextAirAt) return a.nextAirAt ? -1 : 1;
    if (a.nextAirAt && b.nextAirAt) {
      return a.nextAirAt.localeCompare(b.nextAirAt);
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  if (orderedWatching.length > 0) {
    await expect(page.locator('.p5 .program h3').first()).toHaveText(
      orderedWatching[0]?.title ?? '',
    );
  }
  const hasAiring = watching.some((item) => item.nextAirAt);
  await expect(page.locator('.p5 .schedule')).toHaveCount(hasAiring ? 1 : 0);

  // P6 工具：抽屉来自 D1 启用项（后台 CRUD 会并行增删，不绑定瞬时条数）
  await page.goto('/?p=5');
  const drawers = page.locator('.p6 .drawers .drawer:not(.drawer--more)');
  const drawerCount = await drawers.count();
  expect(drawerCount).toBeGreaterThan(0);
  expect(drawerCount).toBeLessThanOrEqual(8);
  await expect(drawers.locator('.dn').first()).not.toBeEmpty();
});
