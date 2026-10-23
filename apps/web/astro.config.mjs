// @ts-check

import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

// 主站：Astro SSR + Cloudflare Workers + D1 + R2
// 设计稿在 git 分支 design；生产页面逐步迁移到 src/pages。
export default defineConfig({
  site: 'https://myon.top',
  output: 'server',
  // 关掉开发工具条：它会盖住页面底部，而 Playwright 会穿透 shadow DOM
  // 匹配到它内部的 h1，导致 E2E 选择器误命中。
  devToolbar: { enabled: false },
  adapter: cloudflare({
    // 构建期处理图片，避免依赖 Cloudflare Images 绑定
    imageService: 'compile',
    // 站点设置与 Astro 的 session 共用同一个 KV 命名空间（绑定名 SETTINGS），
    // 否则适配器会自动注入一个没有 id 的 SESSION 绑定，生产部署会失败。
    sessionKVBindingName: 'SETTINGS',
  }),
});
