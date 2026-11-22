# 接入链路与边缘网络

> 现状（2026-11）：公开入口是 `www.myon.top`，经 AxisNow 调度到免费边缘，回源 Cloudflare，由单 Worker `myon-blog` 出页面。
> 后台与健康检查只走 `myon.top`，直连 Cloudflare。
> 本文只记录结构、约束与风险，不记录账号 ID、token 与完整节点 IP。

## 1. 链路

```text
访客
 ├─ www.myon.top ─CNAME→ gtm.myon.alidns-2.com   （DNS-only，TTL 120）
 │                        └ AxisNow GTM：internal（中国大陆）/ default（海外）
 │                           候选池：8a2a43f9（AxisNow 官方免费边缘，GCP）
 │                                   deepedge-free（DeepEdge 免费档）
 │                            ▼ 边缘缓存 HTML（约 60s），回源保留 Host
 │                     Cloudflare（Worker route: www.myon.top/*）
 │                            ▼
 └─ myon.top ─A 占位 + Proxied → Cloudflare 直连（Worker route: myon.top/*）
                     ├ /admin*、/api/v1/admin/*：Access 保护的后台，只在这里
                     ├ /api/health：监控探针
                     └ 其余：301 → https://www.myon.top
                                        ▼
                        Worker `myon-blog`（Astro SSR + Hono）
                        D1 / R2 / KV / Images / ASSETS / Cron 6h
```

## 2. 域名与重定向（代码行为）

统一由 `apps/web/src/worker.ts` 处理：

| 主机 + 路径 | 行为 |
| --- | --- |
| `myon.top` 的 `/admin*`、`/api/v1/admin/*`、`/api/health` | 正常处理（后台因此始终直连 Cloudflare） |
| `myon.top` 其余路径 | GET/HEAD 301、其他方法 308 → `https://www.myon.top/...` |
| `www.myon.top` 的 `/admin*`、`/api/v1/admin/*` | 301/308 → `https://myon.top/...` |
| `www.myon.top` 其余路径 | 正常渲染 |

- `apps/web/astro.config.mjs` 的 `site` 与 `generate-wrangler.mjs` 的 `SITE_URL` 默认值都是 `https://www.myon.top`；RSS、canonical 与绝对链接以它为准。
- 规范域名必须是 `www`：apex 的根域 CNAME 会被 Cloudflare flatten，地域线路拿不到（见第 3 节）。

## 3. DNS 与为什么用 www

- Zone `myon.top`（Cloudflare Free），apex 是 Proxied 的占位 A 记录，zone 设置 `cname_flattening = flatten_at_root`。
- 根域 CNAME 由 Cloudflare 代解析：GTM 看到的是 Cloudflare 解析器的位置，`internal`（中国大陆）线路永远不生效。
- `www` 保留完整 CNAME 链，由访客的递归解析器逐跳解析，GTM 能看到真实来源地，大陆解析器才能命中中国线路。
- 结论：apex 不做分流、只做 301；`www` 是唯一能做地域分流的入口。

## 4. 边缘（AxisNow / DeepEdge）

- 产品：AxisNow 旧版 DNS 路由（GTM），调度域 `gtm.myon.alidns-2.com`，TTL 120。
- 两条线路规则：`internal` = 中国大陆、`default` = 海外，均按质量优选返回单个候选 CNAME。
- 候选池只有两个免费边缘：AxisNow 官方免费（GCP，100GB/月/租户）与 DeepEdge 免费档（50GB/月、最高 5Mbps、单共享 CNAME）。
- 响应特征：`Server: Edge/1.1.35`、`X-Cache: HIT/EXPIRED`、`Age`、`__ct_cya_ckt` cookie；会把 Cloudflare 的 `CF-RAY`、`Nel` 透传给访客。
- 边缘对 HTML 的缓存约 60s，且**没有 purge API**：内容更新最多延迟约 60s 才全量生效。
- 回源到 `https://blog.enkansakura.top`，但必须保留 `Host: myon.top`，否则命中不了 Worker route 与 Access。

## 5. Cloudflare 侧

- Worker routes：`myon.top/*`、`www.myon.top/*` → `myon-blog`。
- Access：**单一应用**覆盖 `myon.top/admin*`（含自定义域与 workers.dev 变体），会话 30 分钟；`/api/v1/admin/*` 不在应用路径内，靠同源 cookie / JWT 在 Worker 里校验同一个 AUD。
- Zone 设置现状：`ssl=full`（非 strict）、`min_tls_version=1.0`、`cache_level=aggressive`、`browser_cache_ttl=14400`、zone 级 HSTS 关闭、`development_mode=off`。
- 静态资源缓存与 Cache-Tag 由 `apps/web/public/_headers` 定义（`myon-assets` / `myon-css` / `myon-js` / `myon-astro` / `myon-static`）。

## 6. Worker 侧的缓存与探针

- 公开 HTML 200 追加 `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`；排除后台、`/api/*` 与带 `Set-Cookie` 的响应。
- 维护模式：KV `maintenance_enabled=true` 时前台 HTML GET 返回 503 维护页（`no-store`、`Retry-After: 600`），`/admin`、`/api`、静态资源与 RSS 放行。
- `/api/health` 不版本化、路径不变，是监控与拨测入口。边缘拨测不要指向 `/aegis_node_ping/` 这类私有路径：它在 AxisNow 系边缘返回 200、在 Cloudflare 返回 301/404，会把 CF 候选的评分压低。

## 7. 性能基线（2026-11-10，tcptest 181 节点）

| 指标 | 改前（apex 2 轮） | 改后（www 2 轮） |
| --- | --- | --- |
| HTTP 200 | 88.0% | 94.6% |
| HTTP 502 | 10.2% | 0 |
| 首包 p50 | 4493ms | 1052ms（边缘缓存命中）/ 4668ms（冷窗口） |
| 大陆命中边缘 | 96.7% GCP 海外 | ≈100% 中国池 |

- 单发对照：`/api/v1/stats` 2.1–3.4s → 0.76–0.82s；首页经边缘 4.5s+ → 1.8–2.1s，Cloudflare 直连 0.8–1.2s。
- 口径提醒：181 节点在 10–20s 内并发，会放大冷缓存回源与 Worker 渲染排队，绝对值不等于单个真实用户的体验。

## 8. 已知风险与待办

1. **apex 连通性**：直连 Cloudflare 的合成探测中约 15% 的节点 connect_timeout（分散在各运营商）。apex 只做 301 且浏览器会缓存，暂时接受；否则只能把 apex 也接到边缘（后台会经过第三方边缘，与「后台只走 Cloudflare」冲突）或迁走权威 DNS。
2. **边缘是免费共享资源**：DeepEdge 50GB/月、5Mbps，超限会掉速或失败；需要时升级商业版。
3. **HTML 缓存 60s 且无 purge**：发布后最多 60s 才全量生效；静态资源仍靠 Cache-Tag 清理。
4. **证书**：apex / www 仍是两张单域名 LE 证书（www 侧 2026-12-26 到期），建议换 `*.myon.top` 泛域名证书。
5. **访问统计失真**：多边缘下 Worker 看到的来源 IP 是边缘出口，`page_views` 的访客指纹会失真；要修需按可信转发头取真实 IP。
6. **Zone 设置偏弱**：`ssl` 应改 `strict`、`min_tls_version` 至少 1.2，再考虑 zone 级 HSTS（应用层 HSTS 已是 180 天 includeSubDomains）。
7. **旧资产未清理**：`old.myon.top`（旧 Worker）、DNSHE 的 `rin.gtm-myon.us.ci`、`blog.enkansakura.top`（Cloudflare 直连逃生舱，建议保留）。
8. **后台只走 apex**：新增边缘或改 DNS 时必须保证回源 Host 仍在 Access 应用范围内，并保持 `/admin*`、`/api/v1/admin/*` 的 `no-store`。

## 9. 复现

- 测速：`https://www.tcptest.cn/http` 的匿名接口（`POST /api/v2/tasks`），用 Playwright 抓 WebSocket 结果帧，得到每节点的响应 IP、首包耗时与完整响应头。直接抓页面 HTML 拿到的是占位演示数据。
- DNS：用 `dig` / DoH（1.1.1.1、dns.google、dns.alidns.com、doh.pub）对比 apex 与 www 的应答形态，确认 apex 是扁平化 A、www 保留 CNAME 链。
- 边缘特征：看 `Server`、`X-Cache`、`Age` 与响应里是否还有 `CF-RAY`。

## 10. 变更记录

- 2026-11-10 P0：`/api/v1/stats` 的 10 个串行 D1 查询改为并发（字段与语义不变）；公开 HTML 加分等级缓存与 `stale-while-revalidate`。
- 2026-11-10 P1：规范域切 `www.myon.top`，apex 只留后台与健康检查，`www` 的 `/admin*` 回跳 apex。
- 2026-11-10 P1：`www` 去掉 DNSHE 一跳直接 CNAME 到 GTM；候选池收敛为两个免费边缘，TTL 600 → 120；禁用边缘层 `www → apex` 301。
- 结果：大陆 502 从 10.2% 降到 0，首包 p50 从 4493ms 降到 1052ms（边缘缓存命中）。
- 回滚：改代码 + 还原 DNS 记录与 Worker route + 还原 AxisNow 规则；以 Dashboard 当前状态为准，仓库不再保存执行快照。
