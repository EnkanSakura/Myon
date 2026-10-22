#!/usr/bin/env node
/**
 * 本地开发种子脚本：初始化本地 D1 时生成示例文章与随机占位图片。
 *
 * 用法（在仓库根目录执行，`pnpm db:seed:local` 会调用本脚本）：
 *   pnpm db:seed:local                  # 生成缺失的占位图 + 示例文章，写入本地 D1
 *   pnpm db:seed:local --force          # 覆盖已有占位图（重新随机一次）
 *   pnpm db:seed:local --images-only    # 只生成占位图，不写 D1
 *   pnpm db:seed:local --dry-run        # 只打印计划，不写文件、不写 D1
 *   pnpm db:seed:local --help
 *
 * 背景：`apps/web/public/assets/` 下的示例图片不入库（见 .gitignore）。本脚本会扫描
 * `seed.sql` 与页面里引用的 `/assets/...` 路径，为其中属于 `gallery/`、`moments/`
 * 和 `cabinet.jpg` 的示例图片生成随机占位图（纯 Node 手写基线 JPEG，无第三方依赖），
 * 保证新克隆的仓库跑 `pnpm db:migrate:local && pnpm db:seed:local` 后页面图片不 404。
 *
 * 只用于本地调试，不参与构建/部署。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web');
const ASSETS_DIR = path.join(WEB_DIR, 'public', 'assets');
const SEED_SQL_PATH = path.join(SCRIPT_DIR, 'seed.sql');
const TMP_SQL_PATH = path.join(SCRIPT_DIR, '.seed-local.tmp.sql');
const WRANGLER_ENTRY = path.join(
  WEB_DIR,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const WRANGLER_CONFIG = path.join(WEB_DIR, 'wrangler.jsonc');
const D1_NAME = 'myon-blog';

/** 示例图片的尺寸（4:3，页面里用 object-fit 裁切）。 */
const IMAGE_WIDTH = 480;
const IMAGE_HEIGHT = 360;
/** JPEG 以 8×8 为编码块；占位图按 8px 色块拼贴。 */
const BLOCK_SIZE = 8;
/** 每次 seed 生成的示例文章数量。 */
const DEMO_POST_COUNT = 8;

/** 只会为这些前缀下的示例图片生成占位图，避免覆盖页面真正依赖的图标/字体等静态资源。 */
const SAMPLE_PREFIXES = ['gallery/', 'moments/'];
const SAMPLE_EXTRA_KEYS = ['cabinet.jpg'];
const IMAGE_EXTENSION_RE = /\.(?:jpe?g|png|webp|gif|avif|svg)$/i;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    force: false,
    imagesOnly: false,
    dryRun: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--force') options.force = true;
    else if (arg === '--images-only') options.imagesOnly = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`未知参数：${arg}（用 --help 查看用法）`);
      process.exit(1);
    }
  }
  return options;
}

function printHelp() {
  console.log(`本地种子脚本（示例文章 + 随机占位图片）

用法：
  pnpm db:seed:local                 生成缺失的占位图 + 示例文章，写入本地 D1
  pnpm db:seed:local --force         覆盖已有占位图（重新随机一次）
  pnpm db:seed:local --images-only   只生成占位图，不写 D1
  pnpm db:seed:local --dry-run       只打印计划，不写文件、不写 D1
  pnpm db:seed:local --help          显示本帮助

说明：
  1. 占位图写到 apps/web/public/assets/（这些文件已被 .gitignore 忽略）；
  2. 示例文章写入本地 D1 的 posts 表（id 前缀 demo_p，可重复执行覆盖）；
  3. 已存在的占位图默认跳过，加 --force 才会覆盖；
  4. 需要先生成 apps/web/wrangler.jsonc（pnpm wrangler:config）并跑过本地迁移。`);
}

function hashString(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 可复现的伪随机数（同一个图片 key 每次生成的底图一致，便于比对）。 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hslToRgb(hue, saturation, lightness) {
  const h = ((hue % 1) + 1) % 1;
  const s = Math.max(0, Math.min(1, saturation));
  const l = Math.max(0, Math.min(1, lightness));
  if (s === 0) {
    const gray = clampByte(l * 255);
    return [gray, gray, gray];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [
    clampByte(channel(h + 1 / 3) * 255),
    clampByte(channel(h) * 255),
    clampByte(channel(h - 1 / 3) * 255),
  ];
}

function mixRgb(from, to, amount) {
  const t = Math.max(0, Math.min(1, amount));
  return [
    clampByte(from[0] + (to[0] - from[0]) * t),
    clampByte(from[1] + (to[1] - from[1]) * t),
    clampByte(from[2] + (to[2] - from[2]) * t),
  ];
}

// ---------------------------------------------------------------------------
// 基线 JPEG 编码器（4:4:4，每个 8×8 编码块用纯色填充）
// ---------------------------------------------------------------------------

/** 写入高字节在前的 16 位长度。 */
function uint16(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function jpegSegment(marker, payload) {
  return [0xff, marker, ...uint16(payload.length + 2), ...payload];
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.bitBuffer = 0;
    this.bitLength = 0;
  }

  pushByte(byte) {
    this.bytes.push(byte);
    // JPEG 熵编码段里 0xFF 后面必须补 0x00，避免被当成标记。
    if (byte === 0xff) this.bytes.push(0x00);
  }

  writeBits(value, bitCount) {
    for (let i = bitCount - 1; i >= 0; i -= 1) {
      this.bitBuffer = (this.bitBuffer << 1) | ((value >> i) & 1);
      this.bitLength += 1;
      if (this.bitLength === 8) {
        this.pushByte(this.bitBuffer & 0xff);
        this.bitBuffer = 0;
        this.bitLength = 0;
      }
    }
  }

  flush() {
    if (this.bitLength > 0) {
      this.pushByte((this.bitBuffer << (8 - this.bitLength)) & 0xff);
      this.bitBuffer = 0;
      this.bitLength = 0;
    }
  }
}

const DC_CATEGORY_MAX = 11;

/**
 * 把一个纯色 8×8 块写进熵编码流。
 * 常量块的 DCT 只有 DC 系数：F(0,0) = 8 × (通道值 - 128)，AC 全 0（写 EOB）。
 */
function writeFlatBlock(writer, channelValue, previousDc) {
  const dc = 8 * (channelValue - 128);
  const diff = dc - previousDc;
  let category = 0;
  let rest = Math.abs(diff);
  while (rest > 0) {
    category += 1;
    rest >>= 1;
  }
  if (category > DC_CATEGORY_MAX) {
    throw new Error(`DC 系数超出基线 JPEG 范围：${dc}`);
  }

  // DC 表：符号 0..11 统一 4 bit，编码值等于类别号；AC 表只有一个符号 EOB=0（1 bit）。
  writer.writeBits(category, 4);
  if (category > 0) {
    const bits = diff >= 0 ? diff : diff + (1 << category) - 1;
    writer.writeBits(bits, category);
  }
  writer.writeBits(0, 1);
  return dc;
}

function rgbToYCbCr([r, g, b]) {
  return [
    clampByte(0.299 * r + 0.587 * g + 0.114 * b),
    clampByte(-0.168736 * r - 0.331264 * g + 0.5 * b + 128),
    clampByte(0.5 * r - 0.418688 * g - 0.081312 * b + 128),
  ];
}

/**
 * 把按 8×8 分块的 RGB 色块数组编码成基线 JPEG。
 * @param {Array<[number, number, number]>} blocks 行优先的色块数组
 * @param {number} cols 横向块数
 * @param {number} rows 纵向块数
 */
function encodeJpeg(blocks, cols, rows) {
  const width = cols * BLOCK_SIZE;
  const height = rows * BLOCK_SIZE;
  const out = [];

  out.push(0xff, 0xd8); // SOI
  // APP0 / JFIF
  out.push(
    ...jpegSegment(0xe0, [
      0x4a,
      0x46,
      0x49,
      0x46,
      0x00, // "JFIF\0"
      0x01,
      0x01, // version 1.1
      0x00, // aspect ratio
      0x00,
      0x01,
      0x00,
      0x01, // 1:1
      0x00,
      0x00, // 无缩略图
    ]),
  );
  // DQT：量化系数全 1，纯色块的 DC 不被量化误差影响
  out.push(...jpegSegment(0xdb, [0x00, ...new Array(64).fill(0x01)]));
  // SOF0：8bit、3 分量、4:4:4、单量化表
  out.push(
    ...jpegSegment(0xc0, [
      0x08,
      ...uint16(height),
      ...uint16(width),
      0x03,
      0x01,
      0x11,
      0x00,
      0x02,
      0x11,
      0x00,
      0x03,
      0x11,
      0x00,
    ]),
  );
  // DHT（DC 表 0）：0..11 共 12 个符号，统一长度 4
  const dcCodeCounts = new Array(16).fill(0);
  dcCodeCounts[3] = 12; // 长度为 4 的码有 12 个
  out.push(
    ...jpegSegment(0xc4, [
      0x00,
      ...dcCodeCounts,
      ...Array.from({ length: 12 }, (_, index) => index),
    ]),
  );
  // DHT（AC 表 0）：只用到 EOB（符号 0x00），长度 1
  const acCodeCounts = new Array(16).fill(0);
  acCodeCounts[0] = 1;
  out.push(...jpegSegment(0xc4, [0x10, ...acCodeCounts, 0x00]));
  // SOS：3 个分量都使用 DC 表 0 / AC 表 0
  out.push(
    ...jpegSegment(
      0xda,
      [0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00],
    ),
  );

  const writer = new BitWriter();
  let previousY = 0;
  let previousCb = 0;
  let previousCr = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const [channelY, channelCb, channelCr] = rgbToYCbCr(blocks[y * cols + x]);
      previousY = writeFlatBlock(writer, channelY, previousY);
      previousCb = writeFlatBlock(writer, channelCb, previousCb);
      previousCr = writeFlatBlock(writer, channelCr, previousCr);
    }
  }
  writer.flush();

  out.push(...writer.bytes);
  out.push(0xff, 0xd9); // EOI
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// 占位图生成
// ---------------------------------------------------------------------------

function buildPlaceholderBlocks(key) {
  const random = mulberry32(hashString(key) ^ 0x9e3779b9);
  const cols = IMAGE_WIDTH / BLOCK_SIZE;
  const rows = IMAGE_HEIGHT / BLOCK_SIZE;
  const hue = random();

  const paper = hslToRgb(hue, 0.28 + random() * 0.2, 0.84);
  const shade = hslToRgb((hue + 0.06) % 1, 0.4 + random() * 0.2, 0.62);
  const accents = [
    hslToRgb((hue + 0.42) % 1, 0.45, 0.56),
    hslToRgb((hue + 0.62) % 1, 0.5, 0.46),
    hslToRgb((hue + 0.86) % 1, 0.42, 0.66),
  ];

  const blocks = [];
  // 对角渐变底色 + 轻度色块噪点，避免整张图是纯色。
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const position = (x / (cols - 1)) * 0.6 + (y / (rows - 1)) * 0.4;
      const noise = Math.round((random() - 0.5) * 12);
      const base = mixRgb(paper, shade, position);
      blocks.push(base.map((channel) => clampByte(channel + noise)));
    }
  }

  // 随机几何色块（2–4 个矩形），让占位图更像一张图而不是噪点。
  const rectangles = 2 + Math.floor(random() * 3);
  for (let index = 0; index < rectangles; index += 1) {
    const rectWidth = 3 + Math.floor(random() * 10);
    const rectHeight = 3 + Math.floor(random() * 8);
    const startX = Math.floor(random() * (cols - rectWidth));
    const startY = Math.floor(random() * (rows - rectHeight));
    const accent = accents[Math.floor(random() * accents.length)];
    const alpha = 0.55 + random() * 0.35;
    for (let y = startY; y < startY + rectHeight; y += 1) {
      for (let x = startX; x < startX + rectWidth; x += 1) {
        const position = y * cols + x;
        blocks[position] = mixRgb(blocks[position], accent, alpha);
      }
    }
  }

  // 外框：一圈深色，视觉上像一张占位“画框”。
  const ink = hslToRgb(hue, 0.22, 0.2);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
        blocks[y * cols + x] = ink;
      }
    }
  }

  return { blocks, cols, rows };
}

function generatePlaceholderJpeg(key) {
  const { blocks, cols, rows } = buildPlaceholderBlocks(key);
  return encodeJpeg(blocks, cols, rows);
}

/** 从 JPEG / PNG 文件头读尺寸；读不到时返回 null（媒体表里宽度高度允许为空）。 */
function readImageDimensions(buffer) {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      const isStartOfFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isStartOfFrame && offset + 9 < buffer.length) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += 2 + segmentLength;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 收集需要占位的图片 key
// ---------------------------------------------------------------------------

function walkFiles(directory, onFile) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, onFile);
    else if (entry.isFile()) onFile(absolute);
  }
}

function collectSampleImageKeys() {
  const keys = new Set();
  const normalize = (raw) => raw.replace(/^\/+/, '').replace(/^assets\//, '');
  const isSampleKey = (key) =>
    SAMPLE_EXTRA_KEYS.includes(key) ||
    SAMPLE_PREFIXES.some((prefix) => key.startsWith(prefix));

  const addFromReference = (raw) => {
    const key = normalize(raw);
    if (!IMAGE_EXTENSION_RE.test(key) || !isSampleKey(key)) return;
    keys.add(key);
  };

  // 1) seed.sql 里引用的媒体 key（media_key / cover_key / home_cover_image 等）
  const seedSql = fs.readFileSync(SEED_SQL_PATH, 'utf8');
  for (const match of seedSql.matchAll(
    /'([^']+\.(?:jpe?g|png|webp|gif|avif|svg))'/gi,
  )) {
    addFromReference(match[1]);
  }

  // 2) 页面 / 脚本里写死的 /assets/... 引用
  const sourceDirectories = [
    path.join(WEB_DIR, 'src'),
    path.join(WEB_DIR, 'public', 'js'),
  ];
  for (const directory of sourceDirectories) {
    walkFiles(directory, (file) => {
      if (!/\.(?:astro|ts|js|mjs|css)$/i.test(file)) return;
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(
        /\/assets\/([A-Za-z0-9_./-]+\.(?:jpe?g|png|webp|gif|avif|svg))/gi,
      )) {
        addFromReference(match[1]);
      }
    });
  }

  return [...keys].sort();
}

// ---------------------------------------------------------------------------
// 示例文章
// ---------------------------------------------------------------------------

const DEMO_TITLE_POOL = [
  '把本地开发环境重新捋一遍',
  '一页一屏的排版笔记',
  '最近在折腾的几件小事',
  '从零写一个纯 Node 的图片占位脚本',
  '关于「留白」的一点练习',
  '这个月看过的三部动画',
  '给展柜补展签的下午',
  'Cloudflare Workers 冷启动观察',
  '把首页的粉色调亮了一格',
  '用 D1 存评论：一个够用的方案',
  '慢下来的那几天',
  'Markdown 转 HTML 的边界',
  '整理旧照片时想到的',
  '给后台加一个草稿箱',
  '深夜写代码的坏习惯',
  '做一本同人志需要几步',
];

const DEMO_CATEGORIES = ['技术', '设计', '随笔', '动画', '日常', '收藏'];

const DEMO_SLUG_WORDS = [
  'notes',
  'devlog',
  'studio',
  'draft',
  'field',
  'study',
  'diary',
  'bench',
];

const DEMO_EXCERPTS = [
  '一些随手记下的想法，先放着，之后再慢慢整理。',
  '这周做的小实验，记录一下过程和结论。',
  '本来只想改一行，结果顺手重写了一小块。',
  '给以后的自己留个备忘，免得又踩一遍。',
  '短一点的记录，配图是本地生成的占位图。',
];

const DEMO_SECTION_TITLES = [
  '起因',
  '过程',
  '踩到的坑',
  '结论',
  '之后想做的',
  '顺手记一笔',
];

const DEMO_PARAGRAPHS = [
  '一开始只是想验证一个很小的假设，结果把整条链路都重新走了一遍。',
  '本地调试和线上环境的差距，往往比预想的大，所以每一步都留了可回退的余地。',
  '把问题拆小之后，剩下的就是耐心地把每一块拼回去。',
  '这次没有追求一步到位，先让页面能跑，再考虑样式和细节。',
  '写完回头看，真正花时间的不是代码，而是确认边界条件。',
  '留给下一轮的待办已经记在便签上，等有空再继续。',
  '占位图是本地随机生成的，刷新种子脚本就能换一批颜色。',
  '记录一下当前的状态，免得过几天自己也想不起来为什么这么改。',
];

function shuffled(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

function buildDemoBody(title, random) {
  const lines = [`# ${title}`, ''];
  const sections = 2 + Math.floor(random() * 2);
  for (let index = 0; index < sections; index += 1) {
    lines.push(`## ${pick(DEMO_SECTION_TITLES, random)}`, '');
    lines.push(pick(DEMO_PARAGRAPHS, random), '');
    lines.push(pick(DEMO_PARAGRAPHS, random), '');
  }
  lines.push('> 本段内容由本地种子脚本生成，仅用于调试。');
  return lines.join('\n');
}

function buildDemoPosts(imageKeys) {
  const random = mulberry32(0x9e3779b9);
  const titles = shuffled(DEMO_TITLE_POOL, random).slice(0, DEMO_POST_COUNT);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  return titles.map((title, index) => {
    const id = `demo_p${String(index + 1).padStart(2, '0')}`;
    const status = index === DEMO_POST_COUNT - 1 ? 'draft' : 'published';
    const publishedAt = new Date(now - (4 + index * 9) * day).toISOString();
    const updatedAt = new Date(
      now - (3 + index * 9) * day + Math.floor(random() * 6) * 60 * 60 * 1000,
    ).toISOString();
    const createdAt = new Date(now - (6 + index * 9) * day).toISOString();
    const coverKey =
      imageKeys.length > 0 && index % 2 === 0
        ? imageKeys[(index * 3) % imageKeys.length]
        : null;

    return {
      id,
      slug: `demo-${String(index + 1).padStart(2, '0')}-${
        DEMO_SLUG_WORDS[index % DEMO_SLUG_WORDS.length]
      }`,
      title,
      excerpt: pick(DEMO_EXCERPTS, random),
      bodyMd: buildDemoBody(title, random),
      status,
      category: pick(DEMO_CATEGORIES, random),
      publishedAt: status === 'published' ? publishedAt : null,
      updatedAt,
      readingMinutes: 4 + Math.floor(random() * 10),
      coverKey,
      createdAt,
    };
  });
}

// ---------------------------------------------------------------------------
// SQL 组装与写入本地 D1
// ---------------------------------------------------------------------------

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildDemoSql(images, posts) {
  const lines = [
    '-- 以下内容由 packages/back/scripts/seed-local.mjs 生成，只写入本地 D1。',
    "DELETE FROM media WHERE id LIKE 'seed_media_%';",
    "DELETE FROM posts WHERE id LIKE 'demo_p%';",
  ];

  if (images.length > 0) {
    const createdAt = new Date().toISOString();
    const values = images.map((image, index) =>
      [
        sqlString(`seed_media_${String(index + 1).padStart(2, '0')}`),
        sqlString(image.key),
        sqlString(path.basename(image.key)),
        sqlString(image.mime),
        String(image.size),
        image.width === null ? 'NULL' : String(image.width),
        image.height === null ? 'NULL' : String(image.height),
        sqlString(createdAt),
      ].join(', '),
    );
    lines.push(
      'INSERT OR REPLACE INTO media (id, key, filename, mime, size, width, height, created_at) VALUES',
      `  (${values.join('),\n  (')});`,
    );
  }

  if (posts.length > 0) {
    const values = posts.map((post) =>
      [
        sqlString(post.id),
        sqlString(post.slug),
        sqlString(post.title),
        sqlString(post.excerpt),
        sqlString(post.bodyMd),
        sqlString(post.status),
        sqlString(post.category),
        post.publishedAt === null ? 'NULL' : sqlString(post.publishedAt),
        sqlString(post.updatedAt),
        String(post.readingMinutes),
        post.coverKey === null ? 'NULL' : sqlString(post.coverKey),
        sqlString(post.createdAt),
      ].join(', '),
    );
    lines.push(
      'INSERT OR REPLACE INTO posts (id, slug, title, excerpt, body_md, status, category, published_at, updated_at, reading_minutes, cover_key, created_at) VALUES',
      `  (${values.join('),\n  (')});`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function runWranglerSeed() {
  if (!fs.existsSync(WRANGLER_CONFIG)) {
    console.error(
      '✗ 找不到 apps/web/wrangler.jsonc，请先在仓库根目录执行 pnpm wrangler:config',
    );
    process.exit(1);
  }
  if (!fs.existsSync(WRANGLER_ENTRY)) {
    console.error('✗ 找不到本地安装的 wrangler，请先执行 pnpm install');
    process.exit(1);
  }

  const result = spawnSync(
    process.execPath,
    [
      WRANGLER_ENTRY,
      'd1',
      'execute',
      D1_NAME,
      '--local',
      `--file=${TMP_SQL_PATH}`,
    ],
    { cwd: WEB_DIR, stdio: 'inherit' },
  );

  fs.rmSync(TMP_SQL_PATH, { force: true });

  if (result.error) {
    console.error(`✗ 执行 wrangler 失败：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      '✗ 写入本地 D1 失败；如果是全新的本地库，请先执行 pnpm db:migrate:local',
    );
    process.exit(result.status ?? 1);
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const imageKeys = collectSampleImageKeys();
  if (imageKeys.length === 0) {
    console.warn('! 没有在 seed 数据或页面里找到需要占位的示例图片');
  }

  const generated = [];
  const skipped = [];
  /** 本次 seed 后磁盘上实际存在的示例图片（用于写 media 表）。 */
  const presentImages = [];
  const imageMime = (key) =>
    /\.png$/i.test(key)
      ? 'image/png'
      : /\.svg$/i.test(key)
        ? 'image/svg+xml'
        : /\.webp$/i.test(key)
          ? 'image/webp'
          : /\.gif$/i.test(key)
            ? 'image/gif'
            : 'image/jpeg';

  for (const key of imageKeys) {
    const targetPath = path.join(ASSETS_DIR, key);
    const exists = fs.existsSync(targetPath);
    if (exists && !options.force) {
      const buffer = fs.readFileSync(targetPath);
      const dimensions = readImageDimensions(buffer);
      presentImages.push({
        key,
        mime: imageMime(key),
        size: buffer.length,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      });
      skipped.push(key);
      continue;
    }
    const buffer = generatePlaceholderJpeg(key);
    if (!options.dryRun) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, buffer);
    }
    const dimensions = readImageDimensions(buffer);
    if (dimensions === null) {
      throw new Error(`生成的 JPEG 无法解析尺寸：${key}`);
    }
    presentImages.push({
      key,
      mime: 'image/jpeg',
      size: buffer.length,
      width: dimensions.width,
      height: dimensions.height,
    });
    generated.push({ key, buffer });
  }

  const demoPosts = buildDemoPosts(imageKeys);

  if (options.dryRun) {
    console.log('（dry-run，不写文件、不写 D1）');
    console.log(
      `占位图：将生成 ${generated.length} 个，跳过 ${skipped.length} 个已存在`,
    );
    for (const image of generated) console.log(`  + ${image.key}`);
    for (const key of skipped)
      console.log(`  = ${key}（已存在，--force 可覆盖）`);
    console.log(`示例文章：将写入 ${demoPosts.length} 篇`);
    for (const post of demoPosts) console.log(`  + ${post.id}  ${post.title}`);
    return;
  }

  if (generated.length > 0) {
    console.log(
      `✓ 生成占位图 ${generated.length} 个 → apps/web/public/assets/`,
    );
  }
  if (skipped.length > 0) {
    console.log(
      `· 跳过已存在的占位图 ${skipped.length} 个（加 --force 可覆盖重新随机）`,
    );
  }
  if (generated.length === 0 && skipped.length === 0 && imageKeys.length > 0) {
    console.log('· 没有需要生成的占位图');
  }

  if (options.imagesOnly) {
    console.log('· --images-only：未写入本地 D1');
    return;
  }

  const seedSql = fs.readFileSync(SEED_SQL_PATH, 'utf8');
  const demoSql = buildDemoSql(presentImages, demoPosts);
  fs.writeFileSync(TMP_SQL_PATH, `${seedSql}\n\n${demoSql}`, 'utf8');
  console.log(
    `· 写入本地 D1（${D1_NAME}）：seed.sql + ${demoPosts.length} 篇示例文章`,
  );
  runWranglerSeed();
  console.log('✓ 本地种子数据写入完成');
}

try {
  main();
} catch (error) {
  fs.rmSync(TMP_SQL_PATH, { force: true });
  console.error(
    `✗ 本地种子脚本失败：${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
