import { expect, test } from '@playwright/test';

test('七页封面、翻页与深浅色切换', async ({ page, request }) => {
  const res = await request.get('/api/v1/site');
  expect(res.status()).toBe(200);
  const { settings } = (await res.json()) as {
    settings: { home: { title: string } };
  };

  await page.goto('/');
  await expect(page.locator('.p1 .copy h1')).toContainText(settings.home.title);
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

test('尾页后记文案来自站点设置', async ({ page, request }) => {
  const res = await request.get('/api/v1/site');
  expect(res.status()).toBe(200);
  const { settings } = (await res.json()) as {
    settings: {
      author: string;
      end: {
        title: string;
        lead: string;
        afterword: { body: string };
      };
    };
  };

  await page.goto('/');
  const end = page.locator('.p7');
  await expect(end.locator('h2')).toContainText(settings.end.title);
  await expect(end.locator('.after')).toContainText(
    settings.end.lead.replace(/\s+/g, ''),
  );
  // 后记正文里的换行由模板拆成多行/多段，比较时忽略空白
  await expect(end.locator('.letter')).toContainText(
    settings.end.afterword.body.replace(/\s+/g, ''),
  );
  await expect(end.locator('.thank')).toContainText(settings.author);
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

test('封面与第 2 页装饰图走固定长边转换地址', async ({ page, request }) => {
  const res = await request.get('/api/v1/site');
  expect(res.status()).toBe(200);
  const { settings } = (await res.json()) as {
    settings: {
      home: { cover: { image: string }; figures: { a: string; b: string } };
    };
  };
  const home = settings.home;

  await page.goto('/');
  // 站内 /media/ 地址才追加转换参数；后台配了外链时原样输出、跳过参数断言。
  const coverSrc = await page
    .locator('.p1 .frame img')
    .first()
    .getAttribute('src');
  if (home.cover.image.startsWith('/media/'))
    expect(coverSrc ?? '').toMatch(/[?&]size=1600&q=82$/);
  else expect(coverSrc).toBe(home.cover.image);

  // 第 2 页右侧两张装饰图（留空时 /api/v1/site 已回退成封面图）
  const figureSrcs = await page
    .locator('.p2 .side .frame img')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('src') ?? ''),
    );
  expect(figureSrcs).toHaveLength(2);
  for (const [index, figure] of [home.figures.a, home.figures.b].entries()) {
    if (figure.startsWith('/media/'))
      expect(figureSrcs[index] ?? '').toMatch(/[?&]size=1200&q=80$/);
    else expect(figureSrcs[index]).toBe(figure);
  }
});

test('第 2–6 页页头说明来自后台设置，照片按原色显示', async ({
  page,
  request,
}) => {
  const res = await request.get('/api/v1/site');
  expect(res.status()).toBe(200);
  const { settings } = (await res.json()) as {
    settings: { home: { pageNotes: string[] } };
  };
  const pageNotes = settings.home.pageNotes;
  expect(pageNotes).toHaveLength(5);

  await page.goto('/');

  // 第 3 页默认有文案；后台清空后整段不渲染。
  const p3Note = page.locator('.p3 .head p');
  await expect(p3Note).toHaveCount(pageNotes[1] ? 1 : 0);
  if (pageNotes[1]) await expect(p3Note).toHaveText(pageNotes[1]);

  // 第 2/4/5 页：有配置才渲染说明，空字符串不显示。
  for (const [selector, note] of [
    ['.p2 .head p', pageNotes[0]],
    ['.p4 .head p', pageNotes[2]],
    ['.p5 .head p', pageNotes[3]],
  ] as const) {
    const noteLocator = page.locator(selector);
    await expect(noteLocator).toHaveCount(note ? 1 : 0);
    if (note) await expect(noteLocator).toHaveText(note);
  }

  // 第 6 页留空时保留按工具数量生成的动态文案；配置了就用配置值。
  const p6Note = page.locator('.p6 .head p');
  await expect(p6Note).toHaveCount(1);
  if (pageNotes[4]) await expect(p6Note).toHaveText(pageNotes[4]);

  // 去滤镜：封面与第 2 页装饰图 computed filter 为 none，不再有 grayscale。
  for (const img of await page
    .locator('.p1 .frame img, .p2 .side .frame img')
    .all()) {
    expect(await img.evaluate((el) => getComputedStyle(el).filter)).toBe(
      'none',
    );
  }
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
