# 前端平台审计（2026-11-22）

- 工具：`modern-web-guidance legacy-scan`
- 范围：`apps/web`（`src/**/*.astro`、`public/css`、`public/js`）；`packages/*` 无浏览器 UI，未扫描。
- 结果：5 类 guide、50 条命中，逐条对照 `keepWhen` / `dropWhen` 复核后全部成立；审计完成后已按批次修复，下面的约定就是当前代码的写法。

## 1. 已固化的约定

### 1.1 Enter 提交必须兼容输入法

中文输入法确认候选词时按 Enter 不能触发提交：

```js
if (event.key !== 'Enter') return;
event.preventDefault();
if (event.isComposing || event.keyCode === 229) return; // IME 正在选词
submit();
```

- 老写法 `keyCode === 13` 天然免疫；改成 `event.key` 时必须补 IME 判断。
- `<input>` 不需要判断 `shiftKey`（那是 textarea 换行用的）。
- 全仓 `keydown` + Enter 的处理都要遵守：`admin-media.js`（新建/改名分类）、`tool-x.js`、`tool-comic.js`、`combo.js`。

### 1.2 主题三态与 color-scheme

- 没有 `localStorage['myon-theme']` 时等于「跟随系统」，并监听 `prefers-color-scheme` 变化。
- 只有用户主动点击切换时才写 localStorage；初始化不要写。
- 前台两个壳都要有 `<meta name="color-scheme">`，并在内联脚本里同步成实际主题；CSS 里 `[data-theme="dark"]` / `[data-theme="light"]` 各自声明 `color-scheme`。

### 1.3 dialog 关闭

- 优先用 `closedby="any"`；Safari 不支持时用坐标判断兜底——`e.target === dlg` 在点 dialog 自身留白或子元素间隙时会误判。
- 不要用 `html { overflow: hidden }` 锁滚动，改用 `dialog:modal { overscroll-behavior: contain }` + `::backdrop`。

### 1.4 DOM 清理与排序

- 清空子节点用 `replaceChildren()`，不要 `innerHTML = ''`，也不要 `while (firstChild) removeChild(firstChild)`。
- 不可变排序用 `toSorted()`，不要 `slice().sort()`。

## 2. 明确不采用

- 关闭按钮改 `<button command="close" commandfor="…">`：Invoker Commands 还没覆盖 Safari，收益低。

## 3. 复跑

```bash
# 本机 npx 的遥测子进程会被沙箱拦截（spawn EPERM），需要关掉；缓存放到工作区内
DISABLE_TELEMETRY=1 NPM_CONFIG_CACHE="$PWD/.tmp-npm-cache" \
  npx -y modern-web-guidance@latest legacy-scan apps/web --json
```

`legacy-scan` 只覆盖约 20% 有确定性规则的 guide，不等于完整的可访问性 / 性能审计。

## 4. 记录

- 已落地：IME 守卫 5 处、主题三态与 meta、灯箱 `closedby` + 坐标兜底、`replaceChildren()` 40 处、`toSorted()` 3 处、灯箱改用 `overscroll-behavior`。
- 验证：`pnpm lint` / `pnpm check` / `pnpm test` / `pnpm build` / `pnpm deploy:dry` 通过，`pnpm test:e2e` 117 passed。
