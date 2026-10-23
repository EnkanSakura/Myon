#!/usr/bin/env node
/**
 * 由 `wrangler.template.jsonc` 生成 `apps/web/wrangler.jsonc`。
 *
 * 生成的 wrangler.jsonc 不进仓库（本地与 CI 都要先跑一次）：
 *   pnpm wrangler:config
 *
 * 可用环境变量覆盖模板占位符（未设置或为空时使用默认值）：
 *   D1_DATABASE_ID  Cloudflare D1 database_id（默认全 0 占位，仅本地/CI e2e 使用）
 *   R2_BUCKET       R2 bucket 名称（默认 myon-media）
 *   KV_SETTINGS_ID  站点设置用的 KV namespace id（默认全 0 占位，仅本地使用）
 *   SITE_URL        站点地址（默认 https://myon.top）
 *   ENVIRONMENT     运行环境标记（默认 development；生产 workflow 传 production）
 *
 * 模板里还有 `$schema`、`main`、Cron `triggers`、assets 等固定配置，
 * 不要改生成文件，改 `wrangler.template.jsonc`。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, '..');
const TEMPLATE_PATH = path.join(WEB_DIR, 'wrangler.template.jsonc');
const OUTPUT_PATH = path.join(WEB_DIR, 'wrangler.jsonc');

const DEFAULTS = {
  D1_DATABASE_ID: '00000000-0000-0000-0000-000000000000',
  R2_BUCKET: 'myon-media',
  KV_SETTINGS_ID: '00000000000000000000000000000000',
  SITE_URL: 'https://myon.top',
  ENVIRONMENT: 'development',
};

/** JSON 字符串内容转义：占位符位于模板的双引号内，替换进去的值不能破坏 JSON。 */
function escapeJsonString(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\u0000/g, '')
    .replace(/\r?\n/g, ' ');
}

function readVariable(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string') {
    return { value: DEFAULTS[name], usedDefault: true };
  }
  const value = raw.trim();
  if (value === '') {
    return { value: DEFAULTS[name], usedDefault: true };
  }
  return { value, usedDefault: false };
}

/** 模板是 JSONC：去掉整行 `//` 注释后按 JSON 解析，作为生成结果的自检。 */
function parseJsonc(text) {
  const withoutLineComments = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return JSON.parse(withoutLineComments);
}

function main() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`找不到模板：${TEMPLATE_PATH}`);
  }

  let output = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const variables = {};
  const usedDefaults = [];
  for (const name of Object.keys(DEFAULTS)) {
    const variable = readVariable(name);
    variables[name] = variable;
    if (variable.usedDefault) usedDefaults.push(name);
    const placeholder = `__${name}__`;
    if (!output.includes(placeholder)) {
      throw new Error(`模板缺少占位符 ${placeholder}，请检查 ${path.basename(TEMPLATE_PATH)}`);
    }
    output = output.replaceAll(placeholder, escapeJsonString(variable.value));
  }

  const leftover = /__[A-Z0-9_]+__/.exec(output);
  if (leftover) {
    throw new Error(`生成结果仍残留占位符 ${leftover[0]}`);
  }

  const config = parseJsonc(output);
  for (const key of ['main', 'assets', 'triggers', 'd1_databases', 'r2_buckets', 'kv_namespaces', 'vars']) {
    if (!(key in config)) {
      throw new Error(`生成的配置缺少必要字段：${key}`);
    }
  }
  if (config.main !== './src/worker.ts') {
    throw new Error('生成的配置 main 必须指向 ./src/worker.ts（Cron 同步依赖自定义入口）');
  }
  if (!Array.isArray(config.triggers?.crons) || config.triggers.crons.length === 0) {
    throw new Error('生成的配置缺少 triggers.crons（Bangumi 每 6 小时同步会失效）');
  }
  const settingsKv = config.kv_namespaces.find((entry) => entry?.binding === 'SETTINGS');
  if (!settingsKv || typeof settingsKv.id !== 'string' || settingsKv.id === '') {
    throw new Error('生成的配置缺少 SETTINGS KV 绑定（站点设置依赖它）');
  }

  if (!output.endsWith('\n')) output += '\n';
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  const d1 = variables.D1_DATABASE_ID.value;
  const r2 = variables.R2_BUCKET.value;
  const kv = variables.KV_SETTINGS_ID.value;
  const environment = variables.ENVIRONMENT.value;
  const siteUrl = variables.SITE_URL.value;
  const defaultNote = usedDefaults.length > 0 ? `（${usedDefaults.join('/')} 使用默认值）` : '';
  console.log(
    `✓ 已生成 apps/web/wrangler.jsonc · D1 ${d1} · R2 ${r2} · KV ${kv} · ENV ${environment} · SITE_URL ${siteUrl}${defaultNote}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`✗ 生成 wrangler 配置失败：${error.message}`);
  process.exit(1);
}
