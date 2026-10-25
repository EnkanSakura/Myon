# 部署指南 · Myon

本仓库是单 Worker 部署：`@myon/web`（Astro）在构建时把 `@myon/back`（Hono）打进同一个 Worker，
运行时绑定 D1（`DB`，内容数据）、R2（`MEDIA`，图片与附件）、KV（`SETTINGS`，站点设置）与静态资产（`ASSETS`）。

> 站点设置（主题色、页脚、首页文案等）存在 **Workers KV**，D1 里没有 `settings` 表；
> 媒体库直接读 **R2 对象**，D1 里没有 `media` 表。仓库内不保存任何图片资源。

部署配置由 `apps/web/wrangler.template.jsonc` + 环境变量生成，**`apps/web/wrangler.jsonc`
是生成文件、不进仓库**。GitHub Actions 在 CI / Deploy 里统一跑 `pnpm wrangler:config` 生成它。

---

## 1. 前置条件

- 一个 Cloudflare 账号（Workers、D1、R2 可用）。
- 一个可用的域名（可选；用 Cloudflare 托管域名访问体验最好）。
- Node.js ≥ 22.22，pnpm 11（仓库 `packageManager` 字段已固定；可用 `corepack enable`）。
- 把仓库 fork / clone 到本地，并能在 GitHub 上开启 Actions。

本地核对版本：

```bash
node -v    # >= 22.22
pnpm -v    # 11.x
```

跑第 2 节的 `pnpm exec wrangler ...` 之前，先在仓库根目录安装依赖并生成一次 wrangler 配置：

```bash
pnpm install
pnpm wrangler:config   # 生成 apps/web/wrangler.jsonc，详见第 4 节
```

`apps/web` 里调用的 `wrangler` 来自本地依赖（版本由 `pnpm-lock.yaml` 固定）；未安装依赖时
`pnpm exec` 会回退到全局 wrangler，版本可能与仓库不一致。

---

## 2. 创建 D1、R2 与 KV

先登录 Cloudflare（本地开发机）：

```bash
cd apps/web
pnpm exec wrangler login
```

### 2.1 D1

```bash
cd apps/web
pnpm exec wrangler d1 create myon-blog
```

命令输出里会包含 `database_id`（形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`），把它记下来，
填到 GitHub Secret `CLOUDFLARE_D1_DATABASE_ID`。`database_name` 建议保持 `myon-blog`
（Database Migrate workflow 的迁移命令按这个名字执行）。

迁移由 Database Migrate workflow 负责（见第 5 节）；本地开发用（这两个命令读生成的
`apps/web/wrangler.jsonc`，需先按第 4 节执行 `pnpm wrangler:config`）：

```bash
pnpm db:migrate:local
pnpm db:seed:local   # 可选：写入本地演示数据
```

### 2.2 R2

```bash
cd apps/web
pnpm exec wrangler r2 bucket create myon-media
```

如果用了别的 bucket 名称，把它填到 GitHub Variable `R2_BUCKET`（默认 `myon-media`）。

### 2.3 KV（站点设置）

```bash
cd apps/web
pnpm exec wrangler kv namespace create myon-blog-settings
```

命令输出里会包含 KV 的 `id`（32 位十六进制），把它填到 GitHub Secret
`CLOUDFLARE_KV_SETTINGS_ID`。Deploy workflow 用同一个 id 生成 `SETTINGS` 绑定。

> 从旧版本（设置还在 D1 `settings` 表）升级时，需要在 D1 迁移删除该表之前，把旧设置
> 手动导入 KV；仓库不再内置导入脚本，做法见第 5.3 节。

> 如果账号里已有可复用的 KV namespace，也可以直接用它的 id，不必新建；绑定名固定为 `SETTINGS`。
> 本地开发用生成的 `wrangler.jsonc` 里的全 0 占位 id，Wrangler 会在本地模拟 KV，不碰线上。

D1、R2、KV 都只创建一次；以后换账号/换环境再重复本节。

---

## 3. GitHub 配置

位置：仓库 `Settings → Secrets and variables → Actions`。

### 3.1 Secrets

前 4 个是部署流程自己使用的 Secret；`ADMIN_TOKEN`、`ACCESS_*`、`BANGUMI_*`、`IMG2WEBP_TOKEN` 是 **Worker 运行时密钥**，
同样配在仓库 `Settings → Secrets and variables → Actions`。Deploy workflow 会在部署时用
`wrangler deploy --secrets-file` 把它们一并同步到 Worker（见 3.3）；未配置的项自动跳过。

| 名称 | 必填 | 配置位置 | 用途 |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | 是 | GitHub Secret | Actions 调 Cloudflare API：部署 Worker、跑 D1 迁移 |
| `CLOUDFLARE_ACCOUNT_ID` | 是 | GitHub Secret | Cloudflare 账号 ID（Dashboard 右下角 / Workers 概览可见） |
| `CLOUDFLARE_D1_DATABASE_ID` | 是 | GitHub Secret | 第 2.1 节拿到的 D1 database_id；Deploy 用它生成 wrangler 配置 |
| `CLOUDFLARE_KV_SETTINGS_ID` | 是 | GitHub Secret | 第 2.3 节拿到的 KV namespace id；Deploy 用它生成 `SETTINGS` 绑定并迁移旧设置 |
| `ADMIN_TOKEN` | 否 | GitHub Secret → Worker secret | 后台写接口的临时门禁；Deploy 时自动同步到 Worker，见 3.3 |
| `ACCESS_TEAM_DOMAIN` | 否 | GitHub Secret → Worker secret | Cloudflare Access 团队域名，如 `myon.cloudflareaccess.com`；配置后改用 Access JWT 鉴权 |
| `ACCESS_AUD` | 否 | GitHub Secret → Worker secret | Access 应用（API 那个）的 Audience Tag，与 `ACCESS_TEAM_DOMAIN` 成对配置 |
| `CF_ACCESS_CLIENT_ID` | 否 | GitHub Secret | Cloudflare Access Service Token 的 Client ID；配了之后 smoke test 会带上 Access 头（与下一项成对） |
| `CF_ACCESS_CLIENT_SECRET` | 否 | GitHub Secret | 与上一项成对配置；用于让 CI 的 smoke test 通过 Access 保护 |
| `BANGUMI_ACCESS_TOKEN` | 否 | GitHub Secret → Worker secret | Bangumi 同步令牌（Cron 与后台手动同步用） |
| `BANGUMI_USERNAME` | 否 | GitHub Secret → Worker secret | Bangumi 用户名；与上者成对配置，缺一则自动跳过同步 |
| `IMG2WEBP_TOKEN` | 否 | GitHub Secret → Worker secret | GIF → animated WebP 外部服务的 Bearer token；未配置时后台 GIF 上传返回 503 |

`CLOUDFLARE_API_TOKEN` 建议权限：

- `Account → Workers Scripts → Edit`
- `Account → D1 → Edit`
- `Account → Workers KV Storage → Edit`（生成 KV 绑定 + 迁移旧设置）
- `Account → R2 → Edit`（如需在部署流程里管理 bucket；仅发布 Worker 时非必需）

可先选 Cloudflare 的 “Edit Cloudflare Workers” 模板，再额外勾选 D1。

### 3.2 Variables（不是 Secret）

| 名称 | 必填 | 用途 |
| --- | --- | --- |
| `PRODUCTION_URL` | 建议 | 生产站点地址（如 `https://myon.top`），Deploy 的 smoke test 默认 curl `<PRODUCTION_URL>/api/health`；不填则跳过 smoke |
| `SMOKE_URL` | 否 | smoke test 使用的地址（默认取 `PRODUCTION_URL`）。生产域名被 WAF / Bot Fight / 地区限制拦住 CI 时，可指向 `*.workers.dev` 等绕过边缘的地址，见第 9 节 |
| `SITE_URL` | 否 | 写入 Worker 的 `SITE_URL` 变量（默认 `https://myon.top`）；注意：当前代码没有读取它，RSS 与站点绝对链接来自 `apps/web/astro.config.mjs` 的 `site` |
| `R2_BUCKET` | 否 | 写入 R2 binding 的 bucket 名称（默认 `myon-media`） |

### 3.3 Worker 的运行时密钥（Deploy workflow 自动同步）

`ADMIN_TOKEN`、`ACCESS_*`、`BANGUMI_*`、`IMG2WEBP_TOKEN` 属于 Worker 运行时密钥，不在 wrangler 配置模板里。
把值配到仓库 `Settings → Secrets and variables → Actions`（Repository secrets）即可：
Deploy workflow 会读取这些 Secret，生成一份临时 JSON 并随 `pnpm exec wrangler deploy --secrets-file`
一起上传到 Worker；未配置的项自动跳过，密钥值不会打印到日志，部署结束后临时文件立即删除。

注意：

- `--secrets-file` 是**增量**上传：文件里没有的旧密钥不会被删除；
- 首次部署时 Worker 还不存在也能用，密钥随这次部署一起创建，不需要先手动 `wrangler secret put`；
- 之后以 Repository Secret 的值为准：每次 Deploy 都会覆盖 Worker 上的同名密钥。

只想手动改某个密钥（例如本地直连生产 Worker 调试）时，仍可用下面的命令。先按第 4 节执行
`pnpm wrangler:config` 生成 `wrangler.jsonc`，`wrangler secret put` 需要它来识别 Worker 名称：

```bash
cd apps/web

# 后台写接口令牌（不接 Access 时用）
pnpm exec wrangler secret put ADMIN_TOKEN

# Cloudflare Access 模式（与 ADMIN_TOKEN 二选一，配置 Access 后代码优先校验 Access JWT）
pnpm exec wrangler secret put ACCESS_TEAM_DOMAIN
pnpm exec wrangler secret put ACCESS_AUD

# Bangumi 同步
pnpm exec wrangler secret put BANGUMI_ACCESS_TOKEN
pnpm exec wrangler secret put BANGUMI_USERNAME
pnpm exec wrangler secret put IMG2WEBP_TOKEN
```

也可以在 Cloudflare Dashboard 的 Worker → Settings → Variables and Secrets 里查看或临时修改；
下一次 Deploy 会用 Repository Secret 里配置的值覆盖同名密钥。

---

## 4. 本地生成 wrangler 配置

`apps/web/wrangler.jsonc` 是**生成文件、不入库**。克隆仓库/换机器后，在本地开发前先生成一次：

```bash
pnpm install
pnpm wrangler:config
```

可选环境变量（都有默认值）：

```bash
D1_DATABASE_ID=xxxx-xxxx pnpm wrangler:config
R2_BUCKET=myon-media SITE_URL=https://myon.top ENVIRONMENT=development pnpm wrangler:config
```

脚本会：

1. 读取 `apps/web/wrangler.template.jsonc`；
2. 替换 `__D1_DATABASE_ID__` / `__R2_BUCKET__` / `__KV_SETTINGS_ID__` / `__SITE_URL__` / `__ENVIRONMENT__`；
3. 校验生成结果（JSON 可解析、`main` 指向 `./src/worker.ts`、Cron 触发器与 `SETTINGS` KV 绑定存在）；
4. 写到 `apps/web/wrangler.jsonc`，并打印一行摘要。

生成后本地开发即可照常：

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars   # 填本地令牌等
pnpm dev
```

注意事项：

- **不要把 `apps/web/wrangler.jsonc` 提交进仓库**。仓库根 `.gitignore` 已包含
  `apps/web/wrangler.jsonc`，正常情况下它不会被 `git status` 跟踪；只有当历史提交里
  还跟踪着这个文件时，才需要执行一次 `git rm --cached apps/web/wrangler.jsonc`
  停止跟踪（历史里的旧文件不影响运行）。
- 改绑定/变量请改 **`wrangler.template.jsonc`**，不要改生成文件。
- 绑定变化后如类型不匹配，运行 `pnpm types` 重新生成 `apps/web/worker-configuration.d.ts`
  （该文件入库，变更时随代码提交）。
- 本地生成的配置里 D1 `database_id` 与 KV `id` 默认是全 0 占位，仅用于本地/CI e2e，指向本地模拟数据。

---

## 5. 部署流程（三个 workflow 串联）

生产步骤拆成三个 workflow，push `main` 后自动串联：

```text
push main
  └─ Database Migrate（D1 迁移，成功后触发下一步）
       └─ Deploy（构建 + 上传 Worker）
            └─ Smoke Test（等待 3 分钟 → curl /api/health）
```

| Workflow | 文件 | 做什么 | 触发 |
| --- | --- | --- | --- |
| Database Migrate | `.github/workflows/migrate.yml` | 应用 `packages/back/migrations/` 到生产 D1 | push `main` / 手动 |
| Deploy | `.github/workflows/deploy.yml` | 生成配置、构建、同步 Worker secret、`wrangler deploy` | Database Migrate 成功后 / 手动 |
| Smoke Test | `.github/workflows/smoke.yml` | 等待 3 分钟，再请求 `/api/health` | Deploy 成功后 / 手动 |

`Database Migrate` 与 `Deploy` 使用 GitHub Environment `production`（可在仓库里配置审批人）；
`Smoke Test` 只读健康探针，不额外审批。
手动发布时按顺序 Run：先 `Database Migrate`，再 `Deploy`，最后 `Smoke Test`（或等前一个成功后自动触发）。

### 5.1 Database Migrate

1. `pnpm install --frozen-lockfile`；
2. 校验 Secret `CLOUDFLARE_D1_DATABASE_ID` 非空；
3. `pnpm wrangler:config` 生成生产配置（`D1_DATABASE_ID` 来自 Secret，`R2_BUCKET`/`SITE_URL` 来自 Variables，`ENVIRONMENT=production`）；
4. `wrangler d1 migrations apply myon-blog --remote`（按 migration 编号顺序应用 `packages/back/migrations/`：
   0013/0014 删 `media`/`settings` 表，0015 给 `bangumi_shows` 加 `subject_type`，0016 加 `comment`，0017 加 `cover_source`）。

### 5.2 Deploy

1. `pnpm install --frozen-lockfile`；
2. 校验 Secret `CLOUDFLARE_D1_DATABASE_ID` 与 `CLOUDFLARE_KV_SETTINGS_ID` 非空；
3. `pnpm wrangler:config`（同上，另外注入 `KV_SETTINGS_ID` 生成 `SETTINGS` 绑定）；
4. `pnpm build`（Astro + 打包 `@myon/back`，输出 `apps/web/dist`）；
5. 把 Repository Secrets 里的 `ADMIN_TOKEN`/`ACCESS_*`/`BANGUMI_*`/`IMG2WEBP_TOKEN` 写成临时 JSON（未配置的项跳过，值不会打印）；
6. `wrangler deploy --secrets-file <临时 JSON>`（单 Worker，含 Cron triggers，密钥随本次部署一起上传）；
7. 删除临时密钥文件。

### 5.3 旧站点设置迁移（仅从 D1 settings 版本升级时需要）

仓库不再包含自动导入脚本，且 Database Migrate 会删除 `settings` 表。升级前在本地手动执行：

```bash
cd apps/web

# 1. 导出旧设置（必须在 Database Migrate 执行前）
pnpm exec wrangler d1 execute myon-blog --remote --json --command "SELECT key, value FROM settings" > /tmp/myon-settings.json

# 2. 把 results[0].results 里的 key/value 整理成一份 JSON：
#    { "site_name": "Myon", "theme_color": "#EC88C2", ... }
#    保存为 /tmp/myon-settings-kv.json，然后写入 KV
pnpm exec wrangler kv key put site-settings:v1 --path /tmp/myon-settings-kv.json --namespace-id <KV_SETTINGS_ID> --remote
```

全新环境不需要这一步：KV 为空时前台使用 `@myon/shared` 里的默认设置，之后在后台重新填写即可。
若已经跑了删除 `settings` 表的 migration 且没有备份，只能从 D1 备份恢复或后台重新填写。

### 5.4 Smoke Test

Deploy 成功后触发；**先等待 3 分钟**让新 Worker 版本在边缘生效，再请求 `/api/health`。
如果配置了 `PRODUCTION_URL`（或 `SMOKE_URL`），会 curl 健康探针并打印结果；
遇到 Cloudflare 挑战/拦截时会输出响应头与排查提示。未配置 URL 时该 workflow 直接跳过。

**操作**：把改动 push 到 `main` → 打开仓库 Actions → 依次看 `Database Migrate`/`Deploy`/`Smoke Test` 的 run。
失败时先看红叉 step，常见原因见第 9 节。

---

## 6. Cloudflare Access（可选）

后台页面本身没有登录，写接口用 `ADMIN_TOKEN` 临时门禁；接 Cloudflare Access 后改用 Access JWT，
更安全。需要 **两个 Access 应用**：

| 应用 | 保护路径 | 作用 |
| --- | --- | --- |
| A. 后台界面 | `/admin*` | 访问后台页面时要求登录（邮箱/SSO） |
| B. 后台 API | `/api/v1/admin/*` | 给 API 请求加 `Cf-Access-Jwt-Assertion`，由 Worker 校验 |

配置步骤（Cloudflare Zero Trust → Access → Applications → Self-hosted）：

1. 应用 A：域名 = 站点域名，路径 = `/admin*`，加允许策略（邮箱/域名/组）；
2. 应用 B：域名 = 站点域名，路径 = `/api/v1/admin/*`，策略与应用 A 一致；
3. 记下应用 B 的 **Audience Tag**（`ACCESS_AUD`）和团队域名（`ACCESS_TEAM_DOMAIN`，形如
   `<team>.cloudflareaccess.com`）；
4. 把两者配到仓库 Repository Secrets（`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`）后重新跑 Deploy（见 3.3）；
5. 此时 Worker 的 `requireAdmin` 优先校验 Access JWT，`ADMIN_TOKEN` 不再参与；两个变量必须成对配置，
   只配一个会回退到 `ADMIN_TOKEN` 模式。

验证：无痕窗口打开 `https://<站点>/admin` 应跳转 Access 登录；登录后后台接口正常；
不带 JWT 直接 curl `/api/v1/admin/bangumi` 时，请求会先被 Access 在边缘拦截
（通常是 302 跳登录页，非浏览器客户端也可能是 403），到不了 Worker；只有带合法
Access JWT 的请求才会进入 Worker 的 `requireAdmin` 校验。

如果 Deploy 的 smoke test 需要访问受 Access 保护的路径：在 Zero Trust → Access → Service Auth
建一个 Service Token，把 Client ID / Client Secret 配到 Repository Secrets 的
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`，smoke 步骤会自动带上 Access 头。

---

## 7. Bangumi 定时同步

- `apps/web/src/worker.ts` 是自定义 Worker 入口：`fetch` 交给 Astro，`scheduled` 每 6 小时调一次
  `syncBangumi()`；定时规则来自模板里的 `triggers.crons: ["0 */6 * * *"]`。
- 生产同步由 Worker **直连** `api.bgm.tv`；需要 Worker secret `BANGUMI_ACCESS_TOKEN` +
  `BANGUMI_USERNAME`，缺任一个时同步会直接跳过（后台手动同步会提示未配置）。
- 手动触发：后台 `/admin/bangumi` 的「同步 Bangumi」按钮；或 Cloudflare Dashboard →
  Worker → Triggers 查看 Cron 配置。
- 查看日志：`cd apps/web && pnpm exec wrangler tail`（看 `bangumi sync` 输出）。
- 本地调试用代理同步脚本（会走本机代理，不经过部署）：

  ```bash
  pnpm bangumi:sync:local --dry-run   # 只拉取预览
  pnpm bangumi:sync:local             # 写本地 D1
  ```

  默认代理 `http://127.0.0.1:7890`，可用 `BANGUMI_PROXY` 覆盖、`BANGUMI_PROXY=` 表示直连；
  凭据优先读环境变量，否则读 `apps/web/.dev.vars`（详见脚本 `--help`）。

---

## 8. 部署后验收清单

把 `https://<你的域名>` 换成实际地址：

```bash
# 健康探针（不版本化，必须 200 且返回 JSON）
curl -fsS https://<域名>/api/health

# 首页 / 文章 / RSS / 后台
curl -fsS -o /dev/null -w '%{http_code}\n' https://<域名>/
curl -fsS -o /dev/null -w '%{http_code}\n' https://<域名>/articles
curl -fsS -o /dev/null -w '%{http_code}\n' https://<域名>/rss.xml
curl -fsS -o /dev/null -w '%{http_code}\n' https://<域名>/admin   # 开了 Access 时是 302 跳登录
```

> CI 的 smoke test 若返回 403、但本机浏览器/`curl` 正常，通常是 Cloudflare 边缘拦了 GitHub Actions 的出口 IP，
> 不是 Worker 问题；按第 9 节处理。

人工检查：

- [ ] 首页、文章、动态、展柜、追番、工具六个前台页面可打开，样式正常；图片 404 说明 R2 里还没有对应对象（后台媒体库上传）。
- [ ] `/tools` 索引与 `/tools/<slug>` 工具页可打开，链接与后台工具列表一致。
- [ ] 后台 `/admin` 可打开（Access 模式下能登录）；设置页能保存并刷新仍是新值（说明 KV 绑定与写入正常）。
- [ ] 上传一张图片后前台能看到（`/media/<key>` 只从 R2 读，仓库里没有回退图片）。
- [ ] `/rss.xml` 内容里的站点地址正确（域名来自 `apps/web/astro.config.mjs` 的 `site`，不对就改它并重新构建部署）。
- [ ] Bangumi 手动同步按钮返回结果合理（未配置令牌会提示「未配置 BANGUMI_ACCESS_TOKEN，已跳过」）。
- [ ] Cloudflare Dashboard → Worker → Triggers 能看到 6 小时 Cron。
- [ ] Workers Logs / `wrangler tail` 中没有持续报错。

---

## 9. 回滚与故障排查

### 回滚

```bash
cd apps/web
pnpm exec wrangler deployments list        # 看最近部署及对应的 Version ID
pnpm exec wrangler rollback <version-id>   # 不传时自动回滚到上一个 100% 流量的版本（跳过最新部署）
```

或在 GitHub Actions 里对上一个正常提交重新 Run `Deploy` workflow。
注意：**D1 迁移是往前执行的**，回滚 Worker 不会回滚数据库；涉及表结构变更时要单独评估。

### 常见问题

| 现象 | 排查 |
| --- | --- |
| `Database Migrate` / `Deploy` 在 `Check required secrets` 失败 | 对应 workflow 缺 GitHub Secret：迁移需要 `CLOUDFLARE_D1_DATABASE_ID`，部署还需要 `CLOUDFLARE_KV_SETTINGS_ID`（错误信息会给出 `::error::` 提示） |
| 设置页保存后刷新丢失，或一直显示默认值 | 检查 Worker 是否有 `SETTINGS` KV 绑定（生成配置里的 `kv_namespaces`）；本地可用 `wrangler kv key get site-settings:v1 --local --namespace-id <id>` 验证；生产检查 Secret `CLOUDFLARE_KV_SETTINGS_ID` |
| 从旧版本升级后站点设置变回默认值 | 升级前未把旧 D1 `settings` 导入 KV。仓库不再内置导入脚本，做法见第 5.3 节；若 `settings` 表已被 migration 删除，只能从 D1 备份恢复或后台重新填写 |
| Deploy 在生成配置/构建后失败 | 看 step 日志；本地复现：`D1_DATABASE_ID=xxx pnpm wrangler:config && pnpm build`（脚本读的是 `D1_DATABASE_ID`，不是 GitHub Secret 名 `CLOUDFLARE_D1_DATABASE_ID`） |
| Deploy 在 `Smoke test` 收到 403、但本机浏览器/`curl` 正常 | 大概率是 Cloudflare 边缘拦了 GitHub Actions 的出口 IP（WAF 自定义规则 / Bot Fight Mode / Security Level / 地区·ASN 限制），不是 Worker 返回的 403。看 step 日志里的 `cf-ray`、`cf-mitigated` 与错误页：① 给 `/api/health` 加 WAF Skip 规则，或把 GitHub Actions IP 段（`https://api.github.com/meta` 的 `actions`）加入允许列表；② 站点在 Access 后面时，建一个 Access Service Token 并把 `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` 配到 Repository Secrets；③ 或把 Variable `SMOKE_URL` 指向绕过边缘的地址（如 `*.workers.dev`） |
| `wrangler deploy` 鉴权失败（401/403） | 检查 `CLOUDFLARE_API_TOKEN` 权限与 `CLOUDFLARE_ACCOUNT_ID`；token 是否过期 |
| D1 迁移报找不到数据库 | `database_name` 应为 `myon-blog`；确认 Secret 里的 database_id 与账号一致；本地可 `cd apps/web && pnpm exec wrangler d1 migrations list myon-blog --remote`（要在 `apps/web` 下执行，根目录会回退到全局 wrangler） |
| 部署成功但 Cron 不触发 | 确认生成配置里有 `triggers.crons`（模板固定配置，别手改生成文件）；重新 deploy；Dashboard → Triggers 是否有记录；Cron 只在生产 Worker 上跑 |
| 后台接口 401 | Access 模式：`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` 必须成对且 AUD 来自 API 应用；令牌模式：`x-admin-token` 与 Worker 的 `ADMIN_TOKEN` 一致 |
| 后台接口 503 | Worker 既没配 Access 也没配 `ADMIN_TOKEN`：把 `ADMIN_TOKEN` 配到 Repository Secrets 后重新跑 Deploy（或按 3.3 手动 secret put） |
| Bangumi 同步提示 `not_configured` | Worker secrets 缺 `BANGUMI_ACCESS_TOKEN`/`BANGUMI_USERNAME`：配到 Repository Secrets 后重新跑 Deploy（或按 3.3 手动 secret put） |
| 图片 404 / 上传后看不到 | 媒体只从 R2 读：检查 `R2_BUCKET` 变量与真实 bucket 名一致、对象 key 是否正确；仓库里没有 `public/assets` 图片回退。管理后台 `/admin/media` 只列出 R2 对象 |
| RSS/绝对链接域名不对 | 改 `apps/web/astro.config.mjs` 的 `site` 后重新构建部署；RSS 标题/描述取自 KV 里的站点设置 |
| 本地 `wrangler` 命令报配置缺失 | 先 `pnpm wrangler:config`；`wrangler.jsonc` 是生成文件，不入库 |
| wrangler 版本不一致/命令找不到 | 用仓库脚本（`pnpm ...`）而不是全局 `npx wrangler`；先 `pnpm install`，版本由 `pnpm-lock.yaml` 固定 |
| 生成配置文件出现在 `git status` | 不应提交。仓库根 `.gitignore` 已忽略 `apps/web/wrangler.jsonc`；若该文件被历史提交跟踪，用 `git rm --cached apps/web/wrangler.jsonc` 停止跟踪 |
| Windows 本地 `pnpm dev` 一启动就失败，日志是 `CreateDirectory: #5 拒绝访问`（`path = miniflare-email-store`） | 项目目录被打上了「低完整性级别」标签（常见于仓库在受限/沙箱环境里创建或安装依赖）：`workerd.exe` 会以低完整性运行，写不了 `%TEMP%`。在 PowerShell 里把仓库根目录重置为 Medium 完整性后重跑 `pnpm dev`：`icacls <仓库根目录> /setintegritylevel "(OI)(CI)M" /T /C /Q` |
