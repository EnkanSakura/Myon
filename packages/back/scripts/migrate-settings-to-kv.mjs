#!/usr/bin/env node
/**
 * 一次性迁移：把 D1 `settings` 表的站点设置导入 Workers KV（键 `site-settings:v1`）。
 *
 * 背景：设置从 D1 迁到 KV 后，migration 会删除 `settings` 表。Deploy workflow
 * 在应用迁移之前运行本脚本，保证旧站点的主题色、页脚、首页文案不丢失。
 *
 * 行为：
 *   1. 检查 KV 里是否已有 `site-settings:v1`；有则跳过（幂等，不覆盖后台改动）；
 *   2. 读取 D1 `settings` 表；表不存在或没有数据时跳过；
 *   3. 把整份 { key: value } 写进 KV。
 *
 * 用法（仓库根目录）：
 *   KV_SETTINGS_ID=<namespace-id> node packages/back/scripts/migrate-settings-to-kv.mjs
 *   KV_SETTINGS_ID=<namespace-id> node packages/back/scripts/migrate-settings-to-kv.mjs --local
 *
 * 生产环境由 `.github/workflows/deploy.yml` 自动调用；本地一般不需要跑。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web');
const WRANGLER_ENTRY = path.join(
  WEB_DIR,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const D1_NAME = 'myon-blog';
const KV_KEY = 'site-settings:v1';

const args = new Set(process.argv.slice(2));
const local = args.has('--local');
const namespaceId = (process.env.KV_SETTINGS_ID ?? '').trim();

function runWrangler(wranglerArgs) {
  return spawnSync(process.execPath, [WRANGLER_ENTRY, ...wranglerArgs], {
    cwd: WEB_DIR,
    encoding: 'utf8',
    env: process.env,
  });
}

function fail(message, result) {
  console.error(`✗ ${message}`);
  if (result?.stderr) console.error(result.stderr.trim());
  if (result?.stdout) console.error(result.stdout.trim());
  process.exit(1);
}

function main() {
  if (!namespaceId) {
    fail(
      '缺少 KV_SETTINGS_ID。请在 Cloudflare 创建 / 复用一个 KV namespace，并把它的 id 通过环境变量传入（Deploy workflow 用 Secret CLOUDFLARE_KV_SETTINGS_ID）。',
    );
  }

  const targetFlag = local ? '--local' : '--remote';

  // 1. KV 已有设置 → 说明迁移过或后台已写入，不覆盖。
  const existing = runWrangler([
    'kv',
    'key',
    'get',
    KV_KEY,
    '--namespace-id',
    namespaceId,
    targetFlag,
  ]);
  const existingValue = existing.stdout.trim();
  if (
    existing.status === 0 &&
    existingValue !== '' &&
    existingValue !== 'Value not found'
  ) {
    console.log('· KV 里已有站点设置，跳过导入');
    return;
  }

  // 2. 读旧 D1 设置；表已被删除时不当作错误。
  const d1 = runWrangler([
    'd1',
    'execute',
    D1_NAME,
    '--json',
    '--command',
    'SELECT key, value FROM settings',
    targetFlag,
  ]);
  if (d1.status !== 0) {
    const combined = `${d1.stdout}\n${d1.stderr}`;
    if (/no such table:\s*settings/i.test(combined)) {
      console.log('· D1 里没有 settings 表（已迁移过或全新环境），跳过导入');
      return;
    }
    fail('读取 D1 settings 表失败', d1);
  }

  let rows = [];
  try {
    const parsed = JSON.parse(d1.stdout);
    rows = Array.isArray(parsed) ? (parsed[0]?.results ?? []) : [];
  } catch {
    fail('无法解析 D1 返回的 JSON');
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('· D1 settings 表没有数据，跳过导入（前台使用默认设置）');
    return;
  }

  const settings = {};
  for (const row of rows) {
    if (row && typeof row.key === 'string' && typeof row.value === 'string') {
      settings[row.key] = row.value;
    }
  }

  // 3. 写进 KV。
  const tmpFile = path.join(
    os.tmpdir(),
    `myon-settings-${Date.now()}-${process.pid}.json`,
  );
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(settings), { mode: 0o600 });
    const put = runWrangler([
      'kv',
      'key',
      'put',
      KV_KEY,
      '--path',
      tmpFile,
      '--namespace-id',
      namespaceId,
      targetFlag,
    ]);
    if (put.status !== 0) fail('写入 KV 失败', put);
    console.log(`✓ 已把 ${Object.keys(settings).length} 项设置从 D1 导入 KV`);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(
    `✗ 迁移站点设置失败：${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
