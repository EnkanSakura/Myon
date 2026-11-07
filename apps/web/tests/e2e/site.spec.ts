import { expect, test } from '@playwright/test';

test.describe('浮动底栏', () => {
  test('内页左格是版权与技术支持，中格备案号，右格 RSS 与邮箱', async ({
    page,
    request,
  }) => {
    const res = await request.get('/api/v1/site');
    expect(res.status()).toBe(200);
    const { settings } = (await res.json()) as {
      settings: { author: string };
    };

    await page.goto('/articles');
    const bar = page.locator('.sitebar');
    await expect(bar).toBeVisible();

    // 顶栏和底栏都浮在内容之上
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe(
      'fixed',
    );

    // 页脚文字来自后台设置，不在测试里写死
    await expect(bar.locator('.sb-copy')).toContainText(settings.author);
    await expect(bar.locator('.sb-tech')).not.toBeEmpty();
    await expect(bar.locator('.sb-icp')).toContainText(/ICP|备案/);
    await expect(bar.locator('.sb-right a')).toHaveCount(2);
  });

  test('首页左格保留翻页器，中右格与内页一致', async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('.sitebar');
    await expect(bar.locator('.pager button')).toHaveCount(7);
    await expect(bar.locator('.sb-icp')).toContainText(/ICP|备案/);
    await expect(bar.locator('.sb-right a')).toHaveCount(2);
  });
});

test.describe('首页翻页', () => {
  test('没有主题色闪光层，面板用透明度切换', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.flash')).toHaveCount(0);

    const transition = await page
      .locator('.panel')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(transition).toContain('opacity');
    expect(transition).not.toContain('transform');

    await page.locator('.pager button[data-go="1"]').click();
    await expect(page.locator('#pageSticker')).toContainText('PAGE 02');
  });
});

test.describe('文章展示', () => {
  test('显示分类，首字不再放大', async ({ page, request }) => {
    await page.goto('/articles/cloudflare-workers-blog');
    await expect(page.locator('.art-kicker .sticker').first()).toHaveText(
      '技术',
    );
    await expect(page.locator('.byline .tag')).toHaveText('技术');

    const css = await (await request.get('/css/pages/article.css')).text();
    expect(css).not.toContain('::first-letter');
  });
});

test.describe('站点配置与订阅', () => {
  test('/rss.xml 输出可解析的订阅源', async ({ request }) => {
    const res = await request.get('/rss.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/rss+xml');
    const text = await res.text();
    expect(text).toContain('<rss version="2.0"');
    expect(text).toContain('<item>');
  });

  test('/api/v1/site 暴露主题色与页脚配置', async ({ request }) => {
    const res = await request.get('/api/v1/site');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      settings: { themeColor: string; footerRss: string };
    };
    expect(body.settings.themeColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(body.settings.footerRss).toBeTruthy();
  });

  test('站点名与作者统一来自设置：品牌、封面年份、署名、展柜标签', async ({
    page,
    request,
  }) => {
    const siteRes = await request.get('/api/v1/site');
    expect(siteRes.status()).toBe(200);
    const { settings } = (await siteRes.json()) as {
      settings: { name: string; author: string };
    };
    const brand = settings.name.toUpperCase();

    // 首页：封面年份标签 + 关于纸卡 aria-label
    await page.goto('/');
    await expect(page.locator('.cover-year')).toContainText(brand);
    await expect(page.locator('.about-card')).toHaveAttribute(
      'aria-label',
      `关于 ${settings.name}（README）`,
    );

    // 内页顶栏品牌、文章作者署名
    await page.goto('/articles');
    await expect(page.locator('.topbar .brand b')).toHaveText(brand);
    const postsRes = await request.get('/api/v1/posts?limit=1');
    expect(postsRes.status()).toBe(200);
    const posts = (await postsRes.json()) as { items: { slug: string }[] };
    expect(posts.items.length).toBeGreaterThan(0);
    await page.goto(`/articles/${posts.items[0].slug}`);
    await expect(page.locator('.byline .who')).toHaveText(settings.author);

    // 展柜灯箱底部标签
    await page.goto('/gallery');
    const first = page
      .locator('.gal-grid .ex')
      .filter({ has: page.locator('img') })
      .first();
    await expect(first).toHaveCount(1);
    await first.locator('.ex-open').click();
    await expect(page.locator('.lb .cap')).toContainText(`${brand} COLLECTION`);

    // 后台品牌同样取站点设置
    await page.goto('/admin');
    await expect(page.locator('.s-brand b')).toHaveText(brand);
  });

  test('head-title 与 head-description 来自站点设置', async ({
    page,
    request,
  }) => {
    const res = await request.get('/api/v1/site');
    expect(res.status()).toBe(200);
    const { settings } = (await res.json()) as {
      settings: {
        name: string;
        subtitle: string;
        description: string;
      };
    };
    const expectedTitle = [settings.name, settings.subtitle]
      .filter(Boolean)
      .join(' ');

    await page.goto('/articles');
    await expect(page).toHaveTitle(`文章 · ${expectedTitle}`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      settings.description,
    );

    // 首页也是同一套规则
    await page.goto('/');
    await expect(page).toHaveTitle(`首页 · ${expectedTitle}`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      settings.description,
    );
  });
});

test.describe('视觉清理', () => {
  test('所有前台页面不再有 .sub / .narration / .kai-note / syncbar', async ({
    page,
  }) => {
    for (const path of [
      '/articles',
      '/moments',
      '/gallery',
      '/bangumi',
      '/tools',
      '/tools/timestamp',
    ]) {
      await page.goto(path);
      expect(await page.locator('.sub').count(), path).toBe(0);
      expect(await page.locator('.narration').count(), path).toBe(0);
      expect(await page.locator('.kai-note').count(), path).toBe(0);
      expect(await page.locator('.syncbar').count(), path).toBe(0);
    }
  });

  test('深色模式投影使用纸白色', async ({ page }) => {
    await page.goto('/articles?theme=dark');
    const shadow = await page
      .locator('.filterbar')
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toContain('rgba(0, 0, 0');
    expect(shadow).not.toContain('rgb(0, 0, 0)');
    expect(shadow).toContain('rgb(241, 234, 230)');
  });
});
