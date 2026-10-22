#!/usr/bin/env node
/**
 * 本地调试用 Bangumi 同步脚本（不参与部署）。
 *
 * 生产同步仍然由 Worker 的 Cron 直连 api.bgm.tv（packages/back/src/bangumi.ts），
 * 本脚本只是为了在本地通过 HTTP 代理访问 api.bgm.tv，并把结果写进本地 D1：
 *   node:http 发 CONNECT 建隧道 → node:tls 包装 socket 发 HTTPS 请求。
 *
 * 用法：
 *   pnpm bangumi:sync:local                 # 走默认代理，拉取并写本地 D1
 *   pnpm bangumi:sync:local --dry-run       # 只拉取并打印映射/ SQL，不写库
 *   pnpm bangumi:sync:local --self-test     # 内置 fixture 跑映射断言，不联网
 *   pnpm bangumi:sync:local --limit 100     # 最多拉取 100 条（默认 500）
 *
 * 凭据：环境变量 BANGUMI_ACCESS_TOKEN / BANGUMI_USERNAME 优先，
 *       否则读 apps/web/.dev.vars（该文件已被 git 忽略）。
 * 代理：默认 http://127.0.0.1:7890，可用 BANGUMI_PROXY 覆盖；
 *       BANGUMI_PROXY= 表示直连。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const WEB_DIR = path.join(REPO_ROOT, 'apps/web');
const DEV_VARS_PATH = path.join(WEB_DIR, '.dev.vars');
const TEMP_SQL_NAME = '.bangumi-sync.tmp.sql';
const TEMP_SQL_PATH = path.join(WEB_DIR, TEMP_SQL_NAME);

const API_HOST = 'api.bgm.tv';
const API_PORT = 443;
const PAGE_SIZE = 50;
const MAX_FETCH = 500;
const DEFAULT_PROXY = 'http://127.0.0.1:7890';
const USER_AGENT = 'myon-blog/1.0 (https://myon.studio)';
const CONNECT_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 20000;

/** Bangumi 收藏类型 → 本站状态（与 packages/back/src/bangumi.ts 保持一致）。 */
const STATUS_BY_TYPE = {
  1: 'wish',
  2: 'watched',
  3: 'watching',
  4: 'paused',
  5: 'paused',
};

/* -------------------------------------------------------------------------- */
/* 参数                                                                       */
/* -------------------------------------------------------------------------- */

function printUsage() {
  console.log(`Bangumi 本地同步（调试用，不参与部署）

用法：
  pnpm bangumi:sync:local [选项]

选项：
  --dry-run     只拉取并打印映射结果 / SQL，不写本地 D1
  --self-test   用内置 fixture 跑映射与 SQL 断言，不联网、不读写 D1
  --limit N     最多拉取 N 条（1–500，默认 500）
  -h, --help    显示本帮助

凭据（二选一）：
  1. 环境变量 BANGUMI_ACCESS_TOKEN / BANGUMI_USERNAME
  2. apps/web/.dev.vars 里的同名变量（该文件不入库）

代理：
  默认 http://127.0.0.1:7890；用 BANGUMI_PROXY 覆盖。
  BANGUMI_PROXY= （空）表示直连 api.bgm.tv。`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    selfTest: false,
    limit: MAX_FETCH,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--self-test') {
      options.selfTest = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      let raw;
      if (arg === '--limit') {
        index += 1;
        raw = argv[index];
      } else {
        raw = arg.slice('--limit='.length);
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > MAX_FETCH) {
        throw new Error(
          `--limit 需要是 1 到 ${MAX_FETCH} 的整数，收到：${raw || '(空)'}`,
        );
      }
      options.limit = value;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

/* -------------------------------------------------------------------------- */
/* 凭据                                                                       */
/* -------------------------------------------------------------------------- */

/** 极简 .dev.vars 解析：KEY=VALUE，忽略空行与 # 注释。 */
function loadDevVars(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[match[1]] = value;
  }
  return vars;
}

function resolveCredentials() {
  const devVars = loadDevVars(DEV_VARS_PATH);
  const envToken = (process.env.BANGUMI_ACCESS_TOKEN || '').trim();
  const envUsername = (process.env.BANGUMI_USERNAME || '').trim();
  const devToken = (devVars.BANGUMI_ACCESS_TOKEN || '').trim();
  const devUsername = (devVars.BANGUMI_USERNAME || '').trim();

  const token = envToken || devToken;
  const username = envUsername || devUsername;
  const sources = [];
  if (envToken || envUsername) sources.push('环境变量');
  if (devToken || devUsername) sources.push('apps/web/.dev.vars');

  return { token, username, source: sources.join(' + ') || '未配置' };
}

function printMissingCredentials(credentials) {
  const missing = [];
  if (!credentials.token) missing.push('BANGUMI_ACCESS_TOKEN');
  if (!credentials.username) missing.push('BANGUMI_USERNAME');
  console.error(`✗ 缺少 Bangumi 凭据：${missing.join('、')}`);
  console.error('');
  console.error('  二选一配置（两种文件的同名变量不要提交进仓库）：');
  console.error('  1. 环境变量：');
  console.error(
    '       BANGUMI_ACCESS_TOKEN=xxx BANGUMI_USERNAME=xxx pnpm bangumi:sync:local',
  );
  console.error('  2. 写入 apps/web/.dev.vars（已被 git 忽略）：');
  console.error('       BANGUMI_ACCESS_TOKEN=xxx');
  console.error('       BANGUMI_USERNAME=xxx');
  console.error('');
  console.error('  --self-test 不需要凭据，可以先用它验证映射逻辑。');
}

/* -------------------------------------------------------------------------- */
/* 代理                                                                       */
/* -------------------------------------------------------------------------- */

function resolveProxy() {
  const configured = process.env.BANGUMI_PROXY;
  const raw = configured === undefined ? DEFAULT_PROXY : String(configured);
  const value = raw.trim();
  if (value === '') return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`BANGUMI_PROXY 不是合法的 URL：${value}`);
  }
  if (url.protocol !== 'http:') {
    throw new Error(
      `BANGUMI_PROXY 目前只支持 http:// 代理（CONNECT 隧道），收到：${value}`,
    );
  }
  const port = Number(url.port || 80);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`BANGUMI_PROXY 的端口不合法：${value}`);
  }
  const auth = url.username
    ? `Basic ${Buffer.from(
        `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
      ).toString('base64')}`
    : null;
  return { raw: value, host: url.hostname, port, auth };
}

/** 通过 HTTP 代理建立到 api.bgm.tv:443 的 TLS 隧道。 */
function openProxyTunnel(proxy) {
  return new Promise((resolve, reject) => {
    const headers = { host: `${API_HOST}:${API_PORT}` };
    if (proxy.auth) headers['proxy-authorization'] = proxy.auth;

    const request = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${API_HOST}:${API_PORT}`,
      headers,
      agent: false,
      timeout: CONNECT_TIMEOUT_MS,
    });

    request.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败：HTTP ${response.statusCode}`));
        return;
      }
      const tlsSocket = tls.connect({ socket, servername: API_HOST }, () =>
        resolve(tlsSocket),
      );
      tlsSocket.on('error', reject);
    });
    request.on('timeout', () => {
      request.destroy(
        new Error(`连接代理超时（${CONNECT_TIMEOUT_MS / 1000}s）`),
      );
    });
    request.on('error', reject);
    request.end();
  });
}

/** BANGUMI_PROXY= 时直连 api.bgm.tv。 */
function openDirectTls() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: API_HOST, port: API_PORT, servername: API_HOST },
      () => resolve(socket),
    );
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy(
        new Error(`连接 ${API_HOST} 超时（${CONNECT_TIMEOUT_MS / 1000}s）`),
      );
    });
    socket.on('error', reject);
  });
}

/* -------------------------------------------------------------------------- */
/* HTTP/1.1：在已经建立的 TLS socket 上发请求并解析响应                        */
/* -------------------------------------------------------------------------- */

function decodeChunked(buffer) {
  const parts = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd < 0) break;
    const size = Number.parseInt(
      buffer.subarray(offset, lineEnd).toString('ascii').split(';')[0],
      16,
    );
    if (!Number.isFinite(size) || size === 0) break;
    const start = lineEnd + 2;
    parts.push(buffer.subarray(start, start + size));
    offset = start + size + 2;
  }
  return Buffer.concat(parts);
}

function parseResponse(buffer) {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd < 0) throw new Error('api.bgm.tv 响应格式异常：缺少响应头');
  const headerLines = buffer
    .subarray(0, headerEnd)
    .toString('utf8')
    .split('\r\n');
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(headerLines[0] || '');
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const headers = {};
  for (const line of headerLines.slice(1)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim();
  }
  let body = buffer.subarray(headerEnd + 4);
  if ((headers['transfer-encoding'] || '').toLowerCase().includes('chunked')) {
    body = decodeChunked(body);
  }
  return { status, headers, body: body.toString('utf8') };
}

function requestOnTlsSocket(socket, requestPath, token) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback(value);
    };

    socket.setTimeout(REQUEST_TIMEOUT_MS, () => {
      finish(
        reject,
        new Error(`请求 api.bgm.tv 超时（${REQUEST_TIMEOUT_MS / 1000}s）`),
      );
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      try {
        finish(resolve, parseResponse(Buffer.concat(chunks)));
      } catch (error) {
        finish(reject, error);
      }
    });
    socket.on('error', (error) => finish(reject, error));

    const lines = [
      `GET ${requestPath} HTTP/1.1`,
      `Host: ${API_HOST}`,
      'accept: application/json',
      `authorization: Bearer ${token}`,
      `user-agent: ${USER_AGENT}`,
      'connection: close',
      '',
      '',
    ];
    socket.write(lines.join('\r\n'));
  });
}

async function requestJson(requestPath, token, proxy) {
  const socket = proxy ? await openProxyTunnel(proxy) : await openDirectTls();
  const response = await requestOnTlsSocket(socket, requestPath, token);
  if (response.status !== 200) {
    const detail = response.body.replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(
      `api.bgm.tv 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`,
    );
  }
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error('api.bgm.tv 返回的不是合法 JSON');
  }
}

/* -------------------------------------------------------------------------- */
/* 拉取 / 映射 / SQL                                                          */
/* -------------------------------------------------------------------------- */

async function fetchCollections({ token, username, proxy, limit }) {
  const entries = [];
  let pageCount = 0;
  for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
    const requestPath =
      `/v0/users/${encodeURIComponent(username)}/collections` +
      `?subject_type=2&limit=${PAGE_SIZE}&offset=${offset}`;
    const payload = await requestJson(requestPath, token, proxy);
    pageCount += 1;
    const page = Array.isArray(payload?.data) ? payload.data : [];
    entries.push(...page);
    if (entries.length >= limit) {
      entries.length = limit;
      break;
    }
    if (page.length < PAGE_SIZE) break;
  }
  return { entries, pageCount };
}

/** 与 packages/back/src/bangumi.ts 的 mapBangumiCollections 保持一致。 */
function mapCollections(entries) {
  const rows = [];
  for (const entry of entries) {
    const subject = entry.subject ?? {};
    const totalEps =
      typeof subject.eps === 'number' && subject.eps > 0 ? subject.eps : 0;
    const watched =
      typeof entry.ep_status === 'number' ? Math.max(0, entry.ep_status) : 0;
    rows.push({
      id: `bg_${entry.subject_id}`,
      bangumiId: entry.subject_id,
      title: (subject.name_cn || subject.name || '未命名').slice(0, 200),
      status: STATUS_BY_TYPE[entry.type ?? 0] ?? 'wish',
      totalEps,
      watchedEps: totalEps > 0 ? Math.min(watched, totalEps) : watched,
      score:
        typeof entry.rate === 'number' && entry.rate > 0
          ? Math.round(entry.rate)
          : null,
      updatedAt: entry.updated_at || new Date().toISOString(),
    });
  }
  return rows;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  return Number.isFinite(value) ? String(value) : 'NULL';
}

/**
 * 生成 upsert SQL：next_air_at / cover_key 只参与 INSERT（新行为 NULL），
 * ON CONFLICT 不更新它们，保留本地人工维护的值。
 */
function buildSql(rows) {
  const tuples = rows.map((row) => {
    const values = [
      sqlString(row.id),
      sqlNumber(row.bangumiId),
      sqlString(row.title),
      sqlString(row.status),
      sqlNumber(row.totalEps),
      sqlNumber(row.watchedEps),
      row.score === null || row.score === undefined
        ? 'NULL'
        : sqlNumber(row.score),
      'NULL',
      'NULL',
      sqlString(row.updatedAt),
    ];
    return `(${values.join(', ')})`;
  });

  return [
    'INSERT INTO bangumi_shows (id, bangumi_id, title, status, total_eps, watched_eps, score, next_air_at, cover_key, updated_at) VALUES',
    `  ${tuples.join(',\n  ')}`,
    'ON CONFLICT(id) DO UPDATE SET title = excluded.title, status = excluded.status, total_eps = excluded.total_eps, watched_eps = excluded.watched_eps, score = excluded.score, updated_at = excluded.updated_at;',
    '',
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* self-test                                                                  */
/* -------------------------------------------------------------------------- */

function runSelfTest() {
  let checks = 0;
  const is = (actual, expected, label) => {
    assert.deepStrictEqual(actual, expected, label);
    checks += 1;
  };
  const ok = (condition, label) => {
    assert.ok(condition, label);
    checks += 1;
  };

  const fixtures = [
    {
      subject_id: 101,
      subject: { name: 'Naruto', name_cn: '火影忍者', eps: 220 },
      type: 3,
      rate: 8,
      ep_status: 50,
      updated_at: '2026-01-02T03:04:05.000Z',
    },
    {
      subject_id: 102,
      subject: { name: 'Mushishi', eps: 26 },
      type: 2,
      rate: 0,
      ep_status: 30,
    },
    {
      subject_id: 103,
      subject: { name_cn: '', name: 'Mono', eps: 0 },
      type: 5,
      ep_status: 3,
    },
    {
      subject_id: 104,
      subject: { name: 'X', eps: 12 },
      type: 99,
      rate: 7.6,
      ep_status: 0,
    },
    {
      subject_id: 105,
      subject: { name_cn: "测试'引号", name: 'Q', eps: 12 },
      type: 1,
      ep_status: -1,
    },
    {
      subject_id: 106,
      type: 2,
      rate: 9.9,
      ep_status: 5,
    },
  ];

  const rows = mapCollections(fixtures);
  is(rows.length, fixtures.length, '条目数量');
  is(
    rows[0],
    {
      id: 'bg_101',
      bangumiId: 101,
      title: '火影忍者',
      status: 'watching',
      totalEps: 220,
      watchedEps: 50,
      score: 8,
      updatedAt: '2026-01-02T03:04:05.000Z',
    },
    'name_cn 优先 / 在看 / 评分取整前',
  );
  is(rows[1].title, 'Mushishi', '缺少 name_cn 时用 name');
  is(rows[1].status, 'watched', 'type=2 → watched');
  is(rows[1].watchedEps, 26, 'ep_status 超过总集数时钳制');
  is(rows[1].score, null, 'rate=0 → null');
  ok(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(rows[1].updatedAt),
    '缺少 updated_at 时补当前时间',
  );
  is(rows[2].title, 'Mono', 'name_cn 为空串时回退 name');
  is(rows[2].status, 'paused', 'type=5 → paused');
  is(rows[2].totalEps, 0, 'eps<=0 → 0');
  is(rows[2].watchedEps, 3, '总集数未知时不钳制');
  is(rows[3].status, 'wish', '未知 type → wish');
  is(rows[3].score, 8, 'rate=7.6 → round 8');
  is(rows[4].title, "测试'引号", '带单引号的标题保留');
  is(rows[4].watchedEps, 0, '负 ep_status → 0');
  is(rows[5].title, '未命名', '没有 subject 时用未命名');
  is(rows[5].score, 10, 'rate=9.9 → round 10');
  is(rows[5].watchedEps, 5, '总集数 0 时保留已看数');

  const sql = buildSql(rows);
  ok(sql.startsWith('INSERT INTO bangumi_shows (id, bangumi_id'), 'SQL 表头');
  ok(sql.includes("'测试''引号'"), 'SQL 单引号转义');
  ok(sql.includes("'未命名'"), 'SQL 中文标题');
  is(
    (sql.match(/NULL, NULL, /g) || []).length,
    6,
    'next_air_at / cover_key 均为 NULL',
  );
  ok(
    sql.includes('ON CONFLICT(id) DO UPDATE SET title = excluded.title'),
    'upsert 冲突更新',
  );
  ok(
    !sql.includes('next_air_at = excluded.next_air_at') &&
      !sql.includes('cover_key = excluded.cover_key'),
    'upsert 保留 next_air_at / cover_key',
  );

  console.log(
    `✓ self-test 通过：${checks} 项断言（映射 / 集数钳制 / 评分取整 / 状态映射 / SQL 转义 / upsert）`,
  );
}

/* -------------------------------------------------------------------------- */
/* 写本地 D1                                                                  */
/* -------------------------------------------------------------------------- */

function writeLocalD1(rows) {
  const sql = buildSql(rows);
  fs.writeFileSync(TEMP_SQL_PATH, sql, 'utf8');
  try {
    console.log(
      `  写入：wrangler d1 execute myon-blog --local --file=${TEMP_SQL_NAME}`,
    );
    // 命令全部由脚本常量拼成（没有用户输入），用 shell 是为了在 Windows 上找到 pnpm.cmd；
    // 传单个命令字符串而不是 args 数组，避免 Node 的 DEP0190 提示。
    const command = [
      'pnpm exec wrangler d1 execute myon-blog --local',
      `--file=${TEMP_SQL_NAME}`,
    ].join(' ');
    const result = spawnSync(command, {
      cwd: WEB_DIR,
      encoding: 'utf8',
      shell: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      if (result.stdout) console.error(result.stdout.trim());
      if (result.stderr) console.error(result.stderr.trim());
      throw new Error(`wrangler 写入本地 D1 失败（exit ${result.status}）`);
    }
  } finally {
    fs.rmSync(TEMP_SQL_PATH, { force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    printUsage();
    process.exit(1);
  }

  if (options.help) {
    printUsage();
    return;
  }
  if (options.selfTest) {
    try {
      runSelfTest();
    } catch (error) {
      console.error(`✗ self-test 失败：${error.message}`);
      process.exit(1);
    }
    return;
  }

  console.log('Bangumi 本地同步（调试用，不参与部署）');

  const credentials = resolveCredentials();
  if (!credentials.token || !credentials.username) {
    printMissingCredentials(credentials);
    process.exit(1);
  }

  const proxy = resolveProxy();
  console.log(
    `  凭据：BANGUMI_USERNAME=${credentials.username}（来源：${credentials.source}）`,
  );
  console.log(`  代理：${proxy ? proxy.raw : '直连（BANGUMI_PROXY 为空）'}`);
  console.log(`  上限：最多 ${options.limit} 条`);

  const { entries, pageCount } = await fetchCollections({
    token: credentials.token,
    username: credentials.username,
    proxy,
    limit: options.limit,
  });
  console.log(`  拉取：${entries.length} 条（${pageCount} 页）`);

  const rows = mapCollections(entries);
  console.log(`  映射：${rows.length} 条`);

  if (rows.length === 0) {
    console.log('  写入：没有记录，跳过本地 D1');
    return;
  }

  if (options.dryRun) {
    console.log('  写入：dry-run，未写本地 D1（SQL 预览如下）');
    console.log(
      buildSql(rows)
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n'),
    );
    return;
  }

  writeLocalD1(rows);
  console.log(
    `  写入完成：${rows.length} 条（next_air_at / cover_key 保留原有值）`,
  );
}

main().catch((error) => {
  console.error(`✗ 同步失败：${error.message}`);
  process.exit(1);
});
