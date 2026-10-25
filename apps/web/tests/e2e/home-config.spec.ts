import { expect, test } from '@playwright/test';

// 首页第一页的文案、七页主标签、数据块与联系方式来自后台设置；
// 窄屏时先滚内容，滚到底才翻页。
test.describe('首页封面配置', () => {
  test('渲染与 /api/v1/site 返回的 home 配置一致', async ({
    page,
    request,
  }) => {
    const res = await request.get('/api/v1/site');
    expect(res.status()).toBe(200);
    const { settings } = (await res.json()) as {
      settings: {
        home: {
          title: string;
          lead: string;
          pages: string[];
          stats: { preset: string; label: string; unit: string }[];
          links: { label: string; href: string }[];
          cover: { image: string; badge: string; note: string };
        };
      };
    };
    const home = settings.home;
    const year = String(new Date().getFullYear());

    await page.goto('/?p=0');
    await expect(page.locator('.p1 .copy h1')).toContainText(home.title);
    await expect(page.locator('.p1 .stat-box')).toHaveCount(home.stats.length);
    await expect(page.locator('.p1 .contacts a')).toHaveCount(
      home.links.length,
    );
    // 说明文字已去掉，只保留标签与前置图标
    await expect(page.locator('.p1 .contacts a')).toHaveText(
      home.links.map((link) => link.label),
    );
    await expect(page.locator('.p1 .contacts a svg')).toHaveCount(
      home.links.length,
    );
    await expect(page.locator('.p1 .contacts a').first()).toHaveAttribute(
      'href',
      home.links[0]?.href as string,
    );
    await expect(page.locator('.p1 .frame img')).toHaveAttribute(
      'src',
      home.cover.image,
    );
    await expect(page.locator('.p1 .frame-wrap .sticker')).toContainText(
      home.cover.badge,
    );
    // 第 2/3/4 页的装饰框也统一用后台配置的封面图，不再引用写死的 /media 路径
    for (const selector of [
      '.p2 .side .frame img',
      '.p3 .mini-panel .frame img',
      '.p4 .collage .frame img',
    ]) {
      const images = page.locator(selector);
      const count = await images.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        await expect(images.nth(i)).toHaveAttribute('src', home.cover.image);
      }
    }

    // 七页主标签都来自配置
    await expect(page.locator('.p1 .kicker .sticker').first()).toHaveText(
      home.pages[0] as string,
    );
    await expect(page.locator('.p2 .kicker .sticker')).toHaveText(
      home.pages[1] as string,
    );
    await expect(page.locator('.p3 .sticker').first()).toHaveText(
      home.pages[2] as string,
    );
    await expect(page.locator('.p4 .kicker .sticker')).toHaveText(
      home.pages[3] as string,
    );
    await expect(page.locator('.p5 .kicker .sticker')).toHaveText(
      home.pages[4] as string,
    );
    await expect(page.locator('.p6 .kicker .sticker')).toHaveText(
      home.pages[5] as string,
    );
    await expect(page.locator('.p7 .label .sticker').first()).toHaveText(
      home.pages[6] as string,
    );

    // 副层标是自动年份，封面图不再有图注，只剩右下角年份
    await expect(page.locator('.p1 .kicker .sticker--paper')).toHaveText(
      `VOL. ${year}`,
    );
    await expect(page.locator('.p1 .frame .cap')).toHaveCount(0);
    await expect(page.locator('.p1 .cover-year')).toContainText(year);
    await expect(page.locator('.p1 .about-card .ah')).not.toContainText(
      '可后台编辑',
    );
  });
});

test.describe('窄屏翻页', () => {
  test('内容高于一屏时先滚动，滚到底才翻页', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto('/?p=0');

    const active = page.locator('.panel.is-active');
    await expect(active).toBeVisible();

    const sizes = await active.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(sizes.scrollHeight).toBeGreaterThan(sizes.clientHeight);

    await page.mouse.move(200, 350);
    await page.mouse.wheel(0, 420);
    await expect
      .poll(() => active.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await expect(page.locator('#pageSticker')).toContainText('PAGE 01');

    await active.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.mouse.wheel(0, 320);
    await expect(page.locator('#pageSticker')).toContainText('PAGE 02');
  });

  test('桌面高度足够时不出现“本页还有内容”提示', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?p=0');
    await expect(page.locator('#scrollCue')).not.toHaveClass(/is-on/);
  });
});
