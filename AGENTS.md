# AGENTS.md

本文件约束在本仓库里工作的自动化代理（编码助手、子代理、CI 里的机器人）。
它写的是**规则**，不是建议。与 README 冲突时以本文件为准：README 面向人，本文件面向代理。

本文只约束**怎么干活**。功能怎么实现、接口有哪些字段、页面长什么样，去读代码、`README.md` 与 `design-spec.md`，本文不复述。

---

## 1. 工作方式

1. **先问，再动手。** 需求含糊、验收标准不明，或存在多种合理取舍（分层、路由、API 契约、视觉方向、数据归属）时，先向维护者提问确认；不要自行补全业务规则，也不要替维护者做决定。
2. **只做被要求的事。** 不顺手重构、不扩大范围、不实现「以后可能用得上」的功能、不新增依赖。发现无关问题就报告，不要顺手改。
3. **先找现成的。** 动手前先确认仓库里已有的工具、插件、脚本、Skill 和共享模块能不能直接用；能用就复用，不要重复造一套。
4. **不确定就查，不要猜。** 事实以代码、`README.md`、`design-spec.md`、`packages/shared` 为准；没验证过的接口、表结构、页面行为一律不要写成结论。
5. **小步可验证。** 一次只做一件事，改完按第 5 节跑完验证再交付。

### 1.1 工具、插件与技能

- 优先使用宿主提供的 tools / plugins / skills：设计类任务交给 UI 设计 Skill，前端实现交给前端 Skill，Office 与文档交给对应 Skill；不要用 shell 或临时脚本绕开它们。
- 仓库自带的脚本、生成器、测试与样式/脚本文件就是既有实现：`pnpm` 脚本、`public/css`、`public/js`、`scripts/`、`packages/shared` 能覆盖的，不要另写一份。
- 新增工具、脚本、配置或依赖前，先在仓库里搜一遍等价物，并在回复里说明为什么必须新增。
- 当前会话实际可用的 Skill 以会话给出的清单为准，本文不维护常驻名单。

## 2. 项目边界

- **一个部署单元**：`@myon/web` 构建时把 `@myon/back` 打进同一个 Worker。不新增 Worker / Pages / 第二个 wrangler 配置，不把 API 拆成独立服务。
- **分层**：`apps/web/src/pages` 只做路由、取数、渲染，不写 SQL、不 import drizzle；`layouts` / `components` 不放业务逻辑与数据查询；`packages/back` 不依赖 Astro 与浏览器 API；`packages/shared` 不依赖 Cloudflare 运行时与 Node 内置模块。页面取数走 `/api/v1`，服务端渲染时进程内 `app.request()`。
- **API 契约**：已发布的 `/api/v1` 只增不改，破坏性改动新增 `/api/v2` 并同时挂载；`/api/health` 永远不版本化、路径不变。
- **绑定与部署配置**：只改 `apps/web/wrangler.template.jsonc` 与 `scripts/generate-wrangler.mjs`；`apps/web/wrangler.jsonc` 与 `worker-configuration.d.ts` 都是生成物，不入库、不手改；改绑定后跑 `pnpm wrangler:config && pnpm types`。Worker 入口 `main` 必须指向 `./src/worker.ts`，`triggers.crons` 不能删。
- **数据库**：schema 先改 `packages/back/src/db/schema.ts`，再新增 `packages/back/migrations/` 下的 SQL，两者同一个提交；已应用的 migration 不改、不删、不改名；查询用 Drizzle 表达式，不拼字符串 SQL。
- **站点设置**：只走 KV `site-settings:v1`，键名与默认值在 `@myon/shared` 的 `siteSettingKeys`；不往 D1 / seed 写设置默认行，不在页面硬编码站点文案、主题色、备案号。
- **媒体**：文件只存 R2、元数据在 D1；上传只走 `storeMedia()`，地址只用 `mediaUrl()` / `contentImageUrl()`，不手拼 `/assets/`、`/media/`，也不用 `/cdn-cgi/image/`。
- **后台**：写接口必须挂 `/api/v1/admin/*` 并经过 `requireAdmin`，不新增无鉴权写端点。
- **密钥**：不写任何 token、账号 ID、`database_id` 到仓库，占位符保持占位。
- **分支**：不碰 `design` 分支，也不从 `main` 引用 `design/`；不改写已推送的 git 历史（不 rebase / amend / force push）。
- **不入库**：`node_modules/`、`dist/`、`.astro/`、`.wrangler/`、`test-results/`、`playwright-report/`、`.dev.vars`。

## 3. 技术约束

- TypeScript 固定 6.x，不升级到 7；包管理器只用 pnpm（版本见 `packageManager`），Node ≥ 22.22；不引入 `package-lock.json` / `yarn.lock`。
- 不引入前端框架替换 Astro + 原生 CSS/JS；组件化用 `.astro`。
- 视觉基线不可动摇：主题色默认 `#EC88C2`、无圆角、硬边框 + 硬阴影、中文界面；颜色只用 `--pink` / `--pink-soft` / `--pink-wash` / `--pink-deep` / `--on-pink` 变量，不写死色值；照片按原色显示，不加滤镜、不叠色。
- 样式归属：设计令牌与共享组件在 `public/css/v2.css`，规范见 `design-spec.md`；页面样式放 `public/css/pages/`、页面脚本放 `public/js/pages/`；页面样式在 `v2.css` 之后加载，只覆盖布局，不覆盖共享组件的字体 / 字号 / 颜色 / 边框 / 内边距。
- 页面壳体：前台内页一律 `SiteLayout.astro`，后台一律 `AdminLayout.astro`；页脚只由 `SiteBar.astro` 渲染，主题色只由 `ThemeTokens.astro` 注入；链接一律用路由，不出现 `.html`。
- 文案：用户可见文案与代码注释用中文，路由 / 类名 / 变量 / 数据库字段用英文；不改写设计稿的标题、栏目名与编号体系。
- 测试：新增或修改 API 行为补 `packages/back/tests/unit`，新增页面、路由、交互补 `apps/web/tests/e2e`；不为通过测试删断言、跳过用例或放宽超时。

## 4. 提交与协作

- **提交或 push 前必须先征得维护者同意**，没有明确同意不要 `git add` 后直接 commit，也不要 push。
- 一次提交只做一件事；消息用中文，前缀 `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`，说明动机与影响。
- 需要看设计稿时用 `git worktree add ../myon-design design`，不要切分支打乱工作区。
- 遇到分层、路由、API 契约、视觉方向这类有取舍的问题，**先问**，不要自行发明规范。

## 5. 验证清单（提交前必须全部通过）

```bash
pnpm lint        # Biome
pnpm check       # astro check + tsc
pnpm test        # Vitest
pnpm build       # Worker 构建
pnpm deploy:dry  # 打包 + 绑定检查，不上线
pnpm test:e2e    # Playwright（Chromium）
```

- 首次跑前先 `pnpm wrangler:config`；首次跑 e2e 前 `pnpm exec playwright install chromium`；需要本地 D1 时 `pnpm db:migrate:local && pnpm db:seed:local`。
- e2e 后台用例依赖 `apps/web/.dev.vars` 的 `ADMIN_TOKEN`。
- 任何一步失败就修到通过，不要注释掉检查项。

## 6. 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm dev` | 本地开发（`http://localhost:4321`） |
| `pnpm types` | 按 wrangler 配置重新生成绑定类型 |
| `pnpm wrangler:config` | 由模板 + 环境变量生成 `apps/web/wrangler.jsonc` |
| `pnpm db:migrate:local` / `db:seed:local` | 本地 D1 迁移 / 种子 |
| `pnpm deploy` | 生产部署，**只在 CI 或维护者明确要求时执行** |

## 7. 交付说明

回复维护者时按顺序写：

1. 改了哪些文件、各自的作用；
2. 跑了哪些验证、结果如何（贴关键输出）；
3. 哪些没做、哪里是占位、下一步建议；
4. 需要维护者决定的分歧点。

不用「应该可以」「大概没问题」这类无法验证的表述；没跑过就写没跑过。
