-- 本地开发种子数据（由 pnpm db:seed:local 调用；示例图片与示例文章见 scripts/seed-local.mjs）
INSERT OR REPLACE INTO settings (key, value) VALUES
  ('site_name', 'Myon'),
  ('site_description', '一个人的二次元生活志'),
  ('site_author', 'Myon'),
  ('site_email', 'hi@myon.studio'),
  ('theme_color', '#EC88C2'),
  ('footer_copyright', '© 2026 MYON'),
  ('footer_tech', 'Astro · Cloudflare Workers · D1 · R2'),
  ('footer_icp', '京ICP备 2026000000 号'),
  ('footer_rss', '/rss.xml'),
  ('footer_email', 'hi@myon.studio'),
  ('default_theme', 'system'),
  ('comments_enabled', 'true'),
  ('home_title', '灯下的一格'),
  ('home_lead', '写字、看番、存图、做点小工具。' || char(10) || '一个人的二次元生活志，自己画、自己印，一共七页。'),
  ('home_page_labels', '["CH.01 封面","CH.02 目次","CH.03 四格","CH.04 收藏","CH.05 放送","CH.06 部室","CH.07 后记"]'),
  ('home_stats', '[{"preset":"latest_update","accent":false},{"preset":"bangumi_watching","accent":true},{"preset":"gallery","accent":false}]'),
  ('home_links', '[{"label":"写邮件","href":"mailto:hi@myon.studio"},{"label":"GitHub","href":"#"},{"label":"Bangumi","href":"#"},{"label":"RSS","href":"/articles"}]'),
  ('home_cover_image', '/assets/cabinet.jpg'),
  ('home_cover_badge', '全七页 / ALL 7'),
  ('home_cover_note', 'LIGHT ON · 只开一盏灯');

INSERT OR REPLACE INTO site_content (key, markdown, updated_at) VALUES
  ('about', '# 关于 Myon

你好，我是 Myon。这里是我自己写、自己排的一本二次元同人志：写字、看番、存图，也做点小工具。

## 最近在做什么

- 把博客从 Pages + Workers + D1 + R2 重新搭了一遍，首页改成七页翻页。
- 追《葬送的芙莉莲》第二季，顺手重写了追番页。
- 在整理展柜里的根付，慢慢补拍摄图。

## 这个站怎么来的

原本只是用笔记软件记点东西，后来想要一个能自己排版的角落。现在它有文章、动态、展柜、追番、工具和后台，一共七页。

> 如果哪一件你也喜欢，留言或者写邮件都行。', '2026-10-20T01:12:00.000Z');

INSERT OR REPLACE INTO posts (id, slug, title, excerpt, body_md, status, category, published_at, updated_at, reading_minutes, cover_key, created_at) VALUES
  ('p_001', 'cloudflare-workers-blog', '在 Cloudflare Workers 上跑一个博客，我踩过的 7 个坑',
   'Pages 负责静态，Workers 负责会变的那一半。',
   '# 在 Cloudflare Workers 上跑一个博客

这个站从零到能写东西，花了我三个周末。

## 先把静态和动态切开

没有登录态、不读写数据库的请求全部交给静态资源；只有需要 D1 / R2 的路径才进 Worker。',
   'published', '技术', '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z', 12, 'gallery/k7-demon.jpg', '2026-09-20T00:00:00.000Z'),
  ('p_002', 'an-afternoon-with-algernon', '读完《献给阿尔吉侬的花束》的那个下午',
   '',
   '# 读完《献给阿尔吉侬的花束》的那个下午

有一天下午，我把自己关在房间里读完了它。',
   'published', '随笔', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z', 6, NULL, '2026-09-10T00:00:00.000Z'),
  ('p_003', 'one-page-one-screen', '我为什么把首页做成一页一屏',
   '',
   '# 我为什么把首页做成一页一屏

一页一屏不是炫技，它只是让每次滑动都像翻一页纸。',
   'published', '设计', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', 8, NULL, '2026-08-28T00:00:00.000Z'),
  ('p_004', 'summer-2026-anime', '2026 夏番小结：把时间交给哪几部',
   '',
   '# 2026 夏番小结

这个夏天只认真追完了三部。',
   'draft', '动画', NULL, '2026-10-18T00:00:00.000Z', 7, NULL, '2026-10-18T00:00:00.000Z');

INSERT OR REPLACE INTO moments (id, body, category, tag, visibility, pinned, media_key, created_at) VALUES
  ('m_186', '凌晨一点，Worker 的冷启动终于稳定在 40ms 以内。值了。', '技术', '技术', 'public', 0, NULL, '2026-10-20T23:10:00.000Z'),
  ('m_185', '神保町买到一本 1987 年的《アイデア》。纸已经黄了，但里面的版式一点不过时。', '收藏', '收藏', 'public', 0, 'gallery/k6-print.jpg', '2026-10-19T22:41:00.000Z'),
  ('m_184', '把追番页面重写了。现在从 Bangumi 拉数据，每 6 小时同步一次。', '技术', '技术', 'public', 0, NULL, '2026-10-19T18:03:00.000Z'),
  ('m_183', '去看了个小的浮世绘展，回来把首页的粉调亮了一格。', '日常', '看番', 'public', 0, 'moments/w3-museum.jpg', '2026-10-18T15:20:00.000Z'),
  ('m_182', '最近在补《虫师》，第 12 话的雨声比白噪音好用。', '日常', '看番', 'public', 0, NULL, '2026-10-17T23:40:00.000Z'),
  ('m_181', '给展柜的每件东西补了展签，拍照真的好难。', '收藏', '收藏', 'public', 0, 'gallery/k3-inro.jpg', '2026-10-16T20:15:00.000Z');

INSERT OR REPLACE INTO gallery_items (id, no, name, category, era, note, media_key, displayed, position, created_at) VALUES
  ('g_005', 'G-005', '鬼之根付', '手办', '明治', '表情用力得过分，每天看一眼，提神。', 'gallery/k7-demon.jpg', 1, 1, '2025-02-21T00:00:00.000Z'),
  ('a_001', 'A-001', '印笼 · 雀与藤', '小物', '19 世纪', '第一次在东京看到印笼，才知道小东西也值得单独一盏灯。', 'gallery/k3-inro.jpg', 1, 2, '2026-10-12T00:00:00.000Z'),
  ('b_014', 'B-014', '达摩根付', '手办', '1980s', '买它那天刚下雪，店主说它已经在柜子里坐了七年。', 'gallery/j2-daruma.jpg', 1, 3, '2025-11-03T00:00:00.000Z'),
  ('c_002', 'C-002', '凯风快晴 · 复刻', '画集', '2024', '', 'gallery/k1-fuji.jpg', 1, 4, '2024-06-18T00:00:00.000Z'),
  ('e_007', 'E-007', '莳绘文箱', '小物', '19 世纪', '', 'gallery/k4-box.jpg', 1, 5, '2025-03-02T00:00:00.000Z'),
  ('h_019', 'H-019', '笑面根付', '手办', '江户', '', 'gallery/m7-laugh.jpg', 1, 6, '2025-08-11T00:00:00.000Z'),
  ('j_003', 'J-003', '人与鼠', '手办', '大正', '', 'gallery/j1-man.jpg', 1, 7, '2025-09-09T00:00:00.000Z'),
  ('f_021', 'F-021', '青花高足碗', '小物', '清', '', 'gallery/k5-bowl.jpg', 1, 8, '2025-10-01T00:00:00.000Z'),
  ('d_031', 'D-031', '江户风俗 · 册页', '纸品', '江户', '', 'gallery/k6-print.jpg', 1, 9, '2025-12-12T00:00:00.000Z');

INSERT OR REPLACE INTO bangumi_shows (id, bangumi_id, title, status, total_eps, watched_eps, score, next_air_at, cover_key, updated_at) VALUES
  ('bg_frieren_s2', 400602, '葬送的芙莉莲 第二季', 'watching', 12, 7, 9, '2026-10-23T15:00:00.000Z', 'gallery/k7-demon.jpg', '2026-10-20T19:02:00.000Z'),
  ('bg_dandadan_s2', 463733, '胆大党 第二季', 'watching', 12, 3, 8, '2026-10-20T17:00:00.000Z', 'gallery/m7-laugh.jpg', '2026-10-20T19:02:00.000Z'),
  ('bg_mushishi', 1050, '虫师', 'watching', 26, 12, 9, NULL, 'gallery/k6-print.jpg', '2026-10-20T19:02:00.000Z');

INSERT OR REPLACE INTO media (id, key, filename, mime, size, width, height, created_at) VALUES
  ('md_001', 'cabinet.jpg', 'cabinet.jpg', 'image/jpeg', 412000, 1600, 1200, '2026-10-20T01:00:00.000Z'),
  ('md_002', 'gallery/k7-demon.jpg', 'k7-demon.jpg', 'image/jpeg', 412000, 2497, 2039, '2026-10-20T01:00:00.000Z'),
  ('md_003', 'gallery/k3-inro.jpg', 'k3-inro.jpg', 'image/jpeg', 388000, 1229, 1600, '2026-10-20T01:00:00.000Z'),
  ('md_004', 'gallery/k1-fuji.jpg', 'k1-fuji.jpg', 'image/jpeg', 342000, 1600, 1096, '2026-10-20T01:00:00.000Z');
