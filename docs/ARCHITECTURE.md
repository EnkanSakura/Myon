# 架构与运行时事实

> 面向维护者与代理的事实清单，按 2026-11 的代码逐项核对过。改绑定、数据归属或发布流程时同步改这里；
> 接入链路与边缘（DNS、AxisNow、Cloudflare）见 [NETWORK.md](./NETWORK.md)，部署步骤见 [DEPLOY.md](./DEPLOY.md)。

## 1. 部署单元

- monorepo：`apps/web`（Astro SSR）+ `packages/back`（Hono API）+ `packages/shared`（类型、Zod、站点设置契约）。
- **只有一个 Worker**：`@myon/web` 构建时把 `@myon/back` 打包进同一个 Worker `myon-blog`，没有第二个部署单元，也没有独立 API 服务。
- Worker 入口是自定义的 `apps/web/src/worker.ts`：`main` 里补了维护模式、规范域名重定向、HTML 缓存头与 Cron 的 `scheduled`，再把请求交给 Astro 的 `handle`。
- 资产由 Workers Static Assets 提供：构建产物 `./dist` 绑定为 `ASSETS`。
- 部署配置：`apps/web/wrangler.template.jsonc` + 环境变量 → `pnpm wrangler:config` → `apps/web/wrangler.jsonc`（**生成物，不入库**）；`apps/web/worker-configuration.d.ts` 由 `pnpm types` 生成，同样不手改。
- `compatibility_date` = `2026-10-12`，`compatibility_flags` = `global_fetch_strictly_public`；`preview_urls: false`（版本预览域能绕过 Access，不要打开）。

## 2. 运行时绑定与变量

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| D1 | `DB` | 内容数据（见第 3 节表清单） |
| R2 | `MEDIA` | 图片对象，`/media/<key>` 只从这里读 |
| KV | `SETTINGS` | 站点设置，唯一键 `site-settings:v1` |
| Images | `IMAGES` | `/media/<key>?size=` 的降采样转换 |
| Assets | `ASSETS` | 构建产物静态文件 |
| 变量 | `SITE_URL` | 站点绝对地址，默认 `https://www.myon.top` |
| 变量 | `ENVIRONMENT` | 运行环境标记，生产传 `production` |
| 密钥 | `ADMIN_TOKEN` | 未接 Access 时的临时后台令牌（`x-admin-token`） |
| 密钥 | `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | Cloudflare Access 校验用 |
| 密钥 | `IMG2WEBP_TOKEN` | GIF → animated WebP 的上游令牌，只留在 Worker |

- 绑定与变量改动只改模板，然后 `pnpm wrangler:config && pnpm types`。
- 定时任务：`triggers.crons = ["0 */6 * * *"]`，`scheduled` 里调 `syncBangumi` 同步追番收藏；删掉这个配置同步就停了。

## 3. 数据归属

**D1（绑定 `DB`）**，schema 在 `packages/back/src/db/schema.ts`：

| 表 | 内容 |
| --- | --- |
| `posts` | 文章（含分类、标签、发布状态） |
| `site_content` | 站点级长文本（关于页 Markdown 等） |
| `moments` | 动态（含分类、`media_size`） |
| `gallery_items` | 展柜藏品（含分类、`media_size`） |
| `bangumi_shows` | 追番，五类 `subject_type`，只由同步维护 |
| `tools` | 工具条目（前台 `/tools` 与后台的唯一数据源） |
| `page_views` | 访问统计原始行 |
| `media_categories` / `media` / `media_aliases` | 媒体元数据：分类、文件名、尺寸、别名 |

- **没有 `settings` 表**：站点设置在 KV。
- **图片文件只在 R2，不在 D1**；D1 只存元数据，R2 key 为 `uploads/<yyyymm>/<uuid>-<name>`，不含分类，所以改分类/别名不会改图片 URL。
- 迁移只在 `packages/back/migrations/` 追加新 SQL（当前到 `0022_moment_media.sql`）；已应用的迁移不改、不删、不改名。schema 与迁移必须同一个提交。

**KV（绑定 `SETTINGS`）**：唯一键 `site-settings:v1` 存一份 JSON，键名与默认值在 `@myon/shared` 的 `siteSettingKeys` / `settings.ts`；不往 D1 或 seed 写设置默认行，缺键由默认值补齐。

## 4. API

- 组合根 `packages/back/src/app.ts`：`secureHeaders()` 全局中间件、`GET /api/health`（不版本化、路径不变）、`app.route(apiBasePath, v1)`。
- 版本常量在 `@myon/shared`：`API_VERSION` / `apiBasePath`。破坏性改动新增 `/api/v2` 并同时挂载，`/api/v1` 只增不改。

**公开只读（`/api/v1`）**：`/posts`、`/posts/:slug`、`/about`、`/site`、`/icons`、`/tools`、`/link-preview`、`/traffic`、`/moments`、`/categories`、`/gallery`、`/bangumi`、`/bangumi/cover`、`/stats`。

**工具工作台（`/api/v1/tools/*`，挂在 `/tools`）**：`/x/media`、`/x/proxy`、`/comics/platforms`、`/comics/:platform/resolve`、`/comics/:platform/pages`、`/comics/:platform/image`；只放行白名单域名，流式中转，不写 D1 / R2。

**后台写接口（`/api/v1/admin/*`，整组经过 `requireAdmin`）**：`settings`、`about`、`posts`（增删查）、`moments`、`gallery`、`bangumi/sync`、`tools`、`media`（列表 / 上传 / 删除）、`media/categories`、`media/gif-webp`。追番没有写接口，条目只由同步维护。

- 列表统一返回 `{ items, total, limit, offset }`，页面用 `?page=` 服务端分页。
- 错误响应统一为 `{ "error": "..." }`；后台响应 `Cache-Control: no-store`。

## 5. 页面

- 前台：`/`（七页翻页封面）、`/articles`、`/articles/:slug`、`/moments`、`/gallery`、`/bangumi`、`/tools`、`/tools/:slug`、`/rss.xml`、`/media/<key>`。
- 后台：`/admin` 及 `/admin/{articles,moments,gallery,bangumi,tools,media,settings,about}`。
- 壳体：前台内页一律 `SiteLayout.astro`，后台一律 `AdminLayout.astro`；页脚只由 `SiteBar.astro` 渲染，主题色只由 `ThemeTokens.astro` 注入。
- 页面取数在 frontmatter 里进程内 `app.request('/api/v1/...')`，不连数据库、不客户端二次请求首屏。

## 6. 请求与缓存链路

`worker.ts` 的顺序：规范域名重定向 → 维护模式判断（KV `maintenance_enabled`，命中返回 503 维护页）→ `page_views` 记录 → Astro `handle` → 给公开 HTML 200 补缓存头。

- HTML：`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`；排除后台、`/api/*`、带 `Set-Cookie` 的响应。
- 静态资源：`apps/web/public/_headers` 分组并打 `Cache-Tag`（`myon-assets` / `myon-css` / `myon-js` / `myon-astro` / `myon-static`），部署后按标签清缓存。
- 图片：`/media/<key>` 只读 R2；加 `?size=&q=` 时走 `IMAGES` 转 WebP，失败或原图更小时回退原图。不要用 `/cdn-cgi/image/`（整站由 Worker 接管会报 9524）。
- 站点设置在 middleware 里读一次，注入 `Astro.locals.site`；页面不要再单独请求。

## 7. 发布流程

- `push main` → `Deploy`（构建 + 部署）→ `Database Migrate`（D1 迁移），两个 workflow 串联，**先部署后迁移**：新 Worker 必须能容忍旧表结构，迁移失败时线上不会缺列 500。
- PR 走 `ci.yml`：Biome → `astro check` → Vitest → build → `wrangler deploy --dry-run` → Playwright。
- 部署前必须先生成配置（CI 用 Secrets/Variables 填 `wrangler.template.jsonc` 的占位符）。

| 命令 | 用途 |
| --- | --- |
| `pnpm wrangler:config` | 由模板 + 环境变量生成 `apps/web/wrangler.jsonc` |
| `pnpm types` | 重新生成 `worker-configuration.d.ts` |
| `pnpm db:migrate:local` / `db:seed:local` | 本地 D1 迁移 / 种子 |
| `pnpm deploy:dry` | 打包 + 绑定检查，不上线 |
| `pnpm deploy` | 生产部署，只在 CI 或维护者明确要求时执行 |

## 8. 不能破的边界

- 不新增 Worker / Pages / 第二个 wrangler 配置，不把 API 拆成独立服务。
- 不手改生成物：`apps/web/wrangler.jsonc`、`apps/web/worker-configuration.d.ts`、`dist/`、`.astro/`。
- 不在页面里直连数据库、拼 SQL 或 import drizzle；数据只经 `/api/v1`。
- 不把站点文案、主题色、备案号、联系方式写进页面，也不另起数据源绕过 `/api/v1/site`。
- 不新增无鉴权的写端点；后台写接口必须挂 `/api/v1/admin/*` 并经过 `requireAdmin`。
