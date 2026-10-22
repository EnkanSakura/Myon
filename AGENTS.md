# AGENTS.md

本文件约束在本仓库里工作的自动化代理（编码助手、子代理、CI 里的机器人）。
它写的是**规则**，不是建议。与 README 冲突时以本文件为准：README 面向人，本文件面向代理。

---

## 1. 事实前提（不要猜）

- **部署单元只有一个 Worker**。仓库是 monorepo，但 `@myon/web` 在构建时把 `@myon/back` 打进同一个 Worker，没有第二个部署单元。
- **两个分支是两套东西**：`main` 是业务代码；`design` 是孤儿分支，只放设计稿（`design/site`、`design/v1`）。`main` 上不存在 `design/` 目录。
- **运行时绑定**：D1（`DB`）、R2（`MEDIA`）、KV（`SESSION`）、静态资产（`ASSETS`）。部署配置由 `apps/web/wrangler.template.jsonc` + 环境变量生成到 `apps/web/wrangler.jsonc`，**生成文件不入库**；CI 与本地都用 `pnpm wrangler:config` 生成。
- **API 已版本化**：内容接口在 `/api/v1/*`，探针 `/api/health` 不版本化。后台写接口在 `/api/v1/admin/*`。
- **站点配置存在 D1**：主题色与页脚文案（版权 / 技术支持 / 备案号 / RSS / 邮箱）在 `settings` 表，键名与默认值定义在 `@myon/shared` 的 `siteSettingKeys`。前台通过 `GET /api/v1/site` 读取，后台设置页通过 `/api/v1/admin/settings` 读写。
- **后台写接口的临时门禁**是环境变量 `ADMIN_TOKEN`（请求头 `x-admin-token`）：未配置时返回 503，配置后不匹配返回 401。Cloudflare Access 接入后替换为校验 Access JWT。
- **文章与动态有分类**：`posts.category`、`moments.category`，接口返回 `category`。
- **列表页数据来自 D1**：文章目次、动态、展柜、追番都在服务端经 `/api/v1/*` 取数渲染；`GET /api/v1/stats` 是公开只读的内容统计，后台总览与前台页头共用。
- **列表接口分页**：四个列表都返回 `{ items, total, limit, offset }`，页面用 `?page=` 服务端分页（默认每页 20，最大 100），不要一次性全量拉取。
- **后台写接口已完整**：`/api/v1/admin/{posts,moments,gallery,bangumi}` 提供 CRUD，`/api/v1/admin/media` 上传/列表/删除（R2），`/api/v1/admin/bangumi/sync` 手动同步。
- **媒体出口**：`GET /media/<key>` 先查 R2、未命中回退 `public/assets`；新图片通过 `POST /api/v1/admin/media` 落到 R2。
- **定时任务**：`apps/web/src/worker.ts` 是自定义 Worker 入口（Astro fetch + Bangumi Cron），`wrangler.jsonc` 的 `main` 指向它，`triggers.crons` 每 6 小时同步一次。
- **媒体地址用 `mediaUrl()`**（`apps/web/src/lib/media.ts`）把 `mediaKey` 换算成前台 URL，不要在页面里手拼 `/assets/`。
- **首页封面可配置**：标题、导语、七页主标签（`home_page_labels`）、最多 4 个数据块（`home_stats` 只存统计预设，数值实时取 `/api/v1/stats`）、最多 6 个联系方式（`home_links` 每条可带 `icon`，值是 Iconify 名称如 `ri:rss-fill`；前台经 `/api/v1/icons` 取回 SVG，后端 `sanitizeIconSvg` 白名单过滤；留空按链接自动识别）、封面图与贴纸文案都存在 `settings`（`home_` 前缀），后台「设置 → 首页」编辑（数据块与联系方式可用行首把手拖拽或每行 ↑ ↓ 调整顺序，顺序即数组顺序；移动端隐藏把手，用按钮排序）。副层标 `VOL. <年份>` 与封面图右下角年份由页面按当前年份自动生成，不配置。
- **图标用 Iconify 名称**：设置里只存 `前缀:名称`（icones.js.org 的写法），不要在数据库里存图标 HTML / 外链脚本；`GET /api/v1/icons?names=...` 批量取 SVG（最多 12 个），上游失败时返回空数组，前台退回内置线稿图标。
- **页脚支持链接**：`footer_tech` / `footer_icp` 允许写多个 `<a>`，后端 `sanitizeFooterHtml` 白名单过滤（a/br/span/strong/em，http/https/mailto）后输出，前台用 `set:html` 渲染。
- **首页窄屏交互**：面板内容高于一屏时先内部滚动，滚到底/顶才翻页，并显示「本页还有内容」提示；不要改回“滚轮直接翻页”。
- **本地 Bangumi 同步**用 `pnpm bangumi:sync:local`（默认走 `127.0.0.1:7890` 代理，`BANGUMI_PROXY` 可覆盖）；生产 Worker 的 Cron 与后台按钮是直连。
- **手机端原生 App** 将来在仓库的另一条分支开发，通过 HTTP 消费 `/api/v1`，不共享 TS 类型。
- **后台页面尚未接入身份验证**：`/admin*` 本身没有登录，只有写接口有令牌门禁。

---

## 2. 硬性约束（违反即回滚，不要“顺手优化”）

1. 不新增部署单元：不新增 Worker、Pages、第二个 `wrangler` 配置，也不把 API 拆成独立服务。
2. 不改已发布的 API 契约：`/api/v1` 的任何字段/语义变更都必须是新增字段或新增版本；破坏性改动一律新增 `/api/v2` 并同时挂载。
3. 始终保持 `/api/health` 不版本化、路径不变（监控与部署 smoke test 依赖它）。
4. TypeScript 固定在 6.x，不要升级到 7。
5. 包管理器只用 pnpm（版本见 `packageManager` 字段），Node ≥ 22.22。不要引入 `package-lock.json`、`yarn.lock`、npm/pnpm 混用。
6. 视觉基线不可动摇：主题色默认 `#EC88C2`、无圆角、硬边框 + 硬阴影的「同人志」风格、中文界面。主题色可由后台配置，页面一律用 `--pink` / `--pink-soft` / `--pink-wash` / `--pink-deep` / `--on-pink` 变量，不写死色值。
7. 不引入前端框架（React/Vue/Svelte）替换现有 Astro + 原生 CSS/JS 页面；组件化用 `.astro`。
8. 不改写 git 历史（不 `rebase`/`amend`/`force push` 已推送的提交）。
9. 不触碰 `design` 分支；不从 `main` 引用 `design/` 下的任何文件。
10. 不提交生成物与本地状态：`node_modules/`、`dist/`、`.astro/`、`.wrangler/`、`test-results/`、`playwright-report/`、`.dev.vars`。
11. 不写任何密钥、token、账号 ID 到仓库；`database_id` 等占位符保持占位（`ADMIN_TOKEN` 只放 `.dev.vars` 或 `wrangler secret`）。
12. 不修改 `apps/web/worker-configuration.d.ts`（生成文件）。改绑定或变量时改模板后运行 `pnpm wrangler:config && pnpm types`。
13. 数据库变更只新增 `packages/back/migrations/` 下的 SQL 文件；已应用的 migration 不修改、不删除、不改名。
14. 页脚文案、备案号、RSS/邮箱、主题色只能来自 D1 设置；页面里不得硬编码这些内容，也不得绕过 `/api/v1/site` 另起数据源。
15. 后台写接口必须挂在 `/api/v1/admin/*` 并经过 `requireAdmin`；不要新增无鉴权的写端点。
16. 上传图片只走 `storeMedia()`（类型白名单 + 8MB 上限），不要自己拼 R2 key。
17. 不改回模板里的 `main`（必须指向 `./src/worker.ts`），也不删 `triggers.crons`，否则 Bangumi 同步会失效。
18. 不提交 `apps/web/wrangler.jsonc`（生成物）；部署配置只改 `wrangler.template.jsonc` 与 `scripts/generate-wrangler.mjs`，真实 database_id 只放环境变量/CI Secret。
19. 新增站点设置项要四处同步：`@myon/shared`（键名 / 默认值 / 校验）、新 migration 的默认行、`scripts/seed.sql`、后台设置页对应字段；首页相关用 `home_` 前缀。

---

## 3. 提交与协作

- **提交前先询问维护者。** 没有明确同意，不要 `git add` 之后直接 `commit`，也不要 push。
- 一次提交只做一件事；消息用中文，前缀用 `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`，正文说清动机与影响。
- 提交前必须逐条跑完第 5 节验证清单，并在回复里贴出结果。
- 遇到分层、路由、API 契约、视觉方向这类有取舍的问题，**先问**，不要自行发明规范。
- 需要看设计稿时用 `git worktree add ../myon-design design`，不要切分支打乱工作区。

---

## 4. 代码约定

### 4.1 分层

| 位置 | 允许做 | 禁止做 |
| --- | --- | --- |
| `apps/web/src/pages` | 路由、取数、渲染、页面交互 | 直接写 SQL、直接 import drizzle、import `cloudflare:workers` 以外的 Worker 内部模块 |
| `apps/web/src/layouts`、`src/components` | 页面壳体、跨页共享片段 | 放业务逻辑、放数据查询 |
| `packages/back` | Hono 路由、数据访问、Markdown 渲染 | 依赖 Astro、依赖浏览器 API |
| `packages/shared` | 纯类型、zod schema、常量 | 依赖 Cloudflare 运行时或 Node 内置模块 |

页面取数走 API，不直连数据库：服务端渲染时在进程内调用 `app.request()`，不要自己拼 SQL。

### 4.2 路由与页面

- 前台内页一律用 `src/layouts/SiteLayout.astro`；后台页面一律用 `src/layouts/AdminLayout.astro`；首页 `src/pages/index.astro` 是七页翻页结构，独立写。
- 页脚统一由 `src/components/SiteBar.astro` 渲染（浮动底栏），主题色统一由 `src/components/ThemeTokens.astro` 注入；页面不要自写 footer，也不要硬编码主题色。
- 顶栏与底栏都是 fixed 浮动层，内容区必须用 `--topbar-h` / `--bottombar-h` 预留高度，不要让内容被遮住且滚不到。
- 页面专属样式放 `public/css/pages/<name>.css`，页面专属脚本放 `public/js/pages/<name>.js`，通过 `is:inline` 的 `<link>` / `<script src>` 引入（`public/` 下的资源不参与打包）。
- 页面样式必须在 `v2.css` 之后加载，不要写进 `v2.css`。
- 不出现指向 `.html` 的链接；一律用路由（如 `/articles`、`/admin/about`）。
- 不在页面里硬编码 API 路径，用 `@myon/shared` 的 `API_VERSION` / `apiBasePath`；站点设置从 `Astro.locals.site` 取（middleware 已注入）。
- 列表页在 frontmatter 里进程内 `app.request('/api/v1/...')` 取数后直接渲染，不要客户端二次请求首屏数据；图片用 `mediaUrl()`，数量统计用 `/api/v1/stats`，不要在页面里自己数字段。
- 列表页分页用 `Astro.url.searchParams.get('page')` 算 `offset`，把 `total` 写进“共 N 条”，用 `?page=N` 链接翻页；筛选只在当页数据上做，计数用 `total`。
- 新增前台路由必须同时在 `apps/web/tests/e2e/pages.spec.ts` 里加一条覆盖；底栏、主题色、RSS 这类全站行为写到 `tests/e2e/site.spec.ts`。

### 4.3 样式

- 设计令牌与基础组件在 `public/css/v2.css`；颜色、字号、间距优先用既有 CSS 变量，不要硬编码十六进制颜色。
- 视觉规范（字号档位、组件归属、暗色与状态规则）见仓库根目录 `design-spec.md`；页面 CSS 只允许覆盖布局属性，**不得覆盖共享组件的字体 / 字号 / 颜色 / 边框 / 内边距**。
- 强调色只用 `--pink` / `--pink-soft` / `--pink-wash` / `--pink-deep` / `--on-pink`；后台配置主题色时这组变量会被整体覆盖，写死色值的元素会跟不上。
- 浮动底栏样式在 `v2.css` 的 `.sitebar` 段；各页只负责左格内容，中格与右格不要绕开组件自己拼。
- 装饰性元素（编号、贴纸、色块）沿用现有类名体系，不要另造一套。
- 响应式断点：前台沿用 `1100px` 与 `760px`；后台控制台另用 `1100px` / `900px` / `600px`（900 折叠侧栏）。
- 除设计稿里已有的圆形元素（光晕、头像、图标）外，不使用 `border-radius`。
- 文字字号下限：顶栏、底栏、贴纸与各页小标签不低于 `10px`；字号只用整数档，共享组件用 `v2.css` 的 `--fs-1`…`--fs-6`。
- 首页面板高度不可假设等于一屏：新增内容必须能在面板内滚动，并保证底部留出 `--bottombar-h`。

### 4.4 文案

- 用户可见文案用中文；代码注释用中文。
- 路由、类名、变量名、数据库字段用英文。
- 不改写设计稿里的标题、栏目名与编号体系（`PAGE 0X / 07`、`CH.0X`）。

### 4.5 数据与内容

- schema 改动：先改 `packages/back/src/db/schema.ts`，再新增 migration，两者同一个提交。
- 查询用 Drizzle 的表达式构建，不拼字符串 SQL。
- `packages/back/scripts/seed.sql` 只放本地演示数据，不写生产内容。
- Markdown 渲染统一走 `packages/back/src/markdown.ts`；新增 HTML 输出必须经过白名单过滤，不要绕过 `sanitizeHtml`。

### 4.6 测试

- 新增或修改 API 行为 → 在 `packages/back/tests/unit` 补单测。
- 新增页面、路由、交互 → 在 `apps/web/tests/e2e` 补用例。
- 不为通过测试删断言、跳过用例、放宽超时；测试确实不该存在时说明理由再删。

---

## 5. 验证清单（提交前必须全部通过）

```bash
pnpm lint        # Biome
pnpm check       # astro check + tsc
pnpm test        # Vitest
pnpm build       # Worker 构建
pnpm deploy:dry  # 打包 + 绑定检查，不上线
pnpm test:e2e    # Playwright（Chromium）
```

- 首次跑前先 `pnpm wrangler:config`（生成 `apps/web/wrangler.jsonc`；默认值即可跑本地 D1）。
- 首次跑 e2e 前：`pnpm exec playwright install chromium`
- 需要本地 D1 时：`pnpm db:migrate:local && pnpm db:seed:local`
- e2e 里的后台用例依赖 `apps/web/.dev.vars` 的 `ADMIN_TOKEN`（可用环境变量覆盖）；CI 会写一份临时 `.dev.vars`。
- 任何一步失败就修到通过，不要注释掉检查项。

---

## 6. 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm dev` | 本地开发（`http://localhost:4321`） |
| `pnpm types` | 按 `wrangler.jsonc` 重新生成绑定类型 |
| `pnpm db:migrate:local` / `db:seed:local` | 本地 D1 迁移 / 种子 |
| `pnpm wrangler:config` | 由模板 + 环境变量生成 `apps/web/wrangler.jsonc` |
| `pnpm bangumi:sync:local` | 本地走代理同步 Bangumi 收藏到本地 D1 |
| `pnpm deploy` | 生产部署，**只在 CI 或维护者明确要求时执行** |

---

## 7. 交付说明

回复维护者时，按这个顺序写：

1. 改了哪些文件、各自的作用；
2. 跑了哪些验证、结果如何（贴关键输出）；
3. 还有哪些没做、哪里是占位、下一步建议；
4. 需要维护者决定的分歧点。

不要用“应该可以”“大概没问题”这类无法验证的表述；没跑过就写没跑过。
