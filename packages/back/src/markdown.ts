import katex from 'katex';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true, breaks: false });

const allowedTags = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'strong',
  'em',
  'del',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'sup',
  'sub',
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags,
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    code: ['class'],
    ol: ['start'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

export interface TocEntry {
  /** 注入到 h2 上的锚点 id，形如 s1 / s2。 */
  id: string;
  /** 去标签后的标题文字，供目录直接渲染。 */
  label: string;
}

const ALERT_LABELS: Record<string, string> = {
  NOTE: '注意',
  TIP: '提示',
  IMPORTANT: '重要',
  WARNING: '警告',
  CAUTION: '谨慎',
};

/**
 * 扩展语法的占位标记：先用私有区字符代替，sanitize 之后再换成真正的组件 HTML。
 * 生成的结构都来自本模块（不含用户 HTML），因此放在 sanitize 之后注入是安全的。
 */
const MARK = {
  mathInlineStart: '\uE010',
  mathInlineEnd: '\uE011',
  mathBlockStart: '\uE012',
  mathBlockEnd: '\uE013',
  spoilerStart: '\uE014',
  spoilerEnd: '\uE015',
  alertStart: '\uE016',
  alertEnd: '\uE017',
  gridStart: '\uE018',
  gridEnd: '\uE019',
  githubStart: '\uE01A',
  githubEnd: '\uE01B',
} as const;

const MARKER_RE = /[\uE010-\uE01B]/g;

// GFM 任务列表的 checkbox 用私有区字符打标，白名单过滤后再换成展示方块。
// 这样 input 不会被放进白名单，也不会给作者开放 span。
const TASK_TODO = '\uE000';
const TASK_DONE = '\uE001';

interface MathBlock {
  tex: string;
  display: boolean;
}

interface AlertBlock {
  type: keyof typeof ALERT_LABELS;
  markdown: string;
}

interface MarkdownStore {
  math: MathBlock[];
  spoilers: string[];
  alerts: AlertBlock[];
  grids: string[];
  github: string[];
}

function createStore(): MarkdownStore {
  return { math: [], spoilers: [], alerts: [], grids: [], github: [] };
}

function token(start: string, end: string, index: number): string {
  return `${start}${index}${end}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: 'ignore',
    });
  } catch {
    const source = display ? `$$${tex}$$` : `$${tex}$`;
    return `<code class="math-src">${escapeHtml(source)}</code>`;
  }
}

/**
 * 在一段纯文本（不含行内代码）里提取 `:spoiler[…]`、行内 `$…$` 与块级 `$$…$$`。
 * 代码围栏和行内代码在外层已经跳过，这里只处理正文。
 */
function transformInlineText(text: string, store: MarkdownStore): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';

    // 反斜杠转义保留原样，交给 marked 处理（\$ 不会被当成公式）
    if (char === '\\' && index + 1 < text.length) {
      out += text.slice(index, index + 2);
      index += 2;
      continue;
    }

    // :spoiler[...]：内容继续当成行内 Markdown，括号支持嵌套
    if (text.startsWith(':spoiler[', index)) {
      let depth = 1;
      let cursor = index + ':spoiler['.length;
      let inner = '';
      while (cursor < text.length && depth > 0) {
        const next = text[cursor] ?? '';
        if (next === '[') depth += 1;
        if (next === ']') {
          depth -= 1;
          if (depth === 0) break;
        }
        inner += next;
        cursor += 1;
      }
      if (depth === 0) {
        store.spoilers.push(transformInlineText(inner, store));
        out += token(
          MARK.spoilerStart,
          MARK.spoilerEnd,
          store.spoilers.length - 1,
        );
        index = cursor + 1;
        continue;
      }
    }

    // $$…$$：块级公式（同一行内也可能书写，交给标记位是否为独立段落决定）
    if (text.startsWith('$$', index)) {
      const close = text.indexOf('$$', index + 2);
      if (close > index) {
        const tex = text.slice(index + 2, close).trim();
        if (tex) {
          store.math.push({ tex, display: true });
          out += token(
            MARK.mathBlockStart,
            MARK.mathBlockEnd,
            store.math.length - 1,
          );
          index = close + 2;
          continue;
        }
      }
    }

    // $…$：行内公式；开头/结尾不能是空白，结束符后不能紧跟数字（给价格让路）
    if (char === '$' && text[index - 1] !== '\\') {
      const next = text[index + 1] ?? '';
      if (next && !/\s/.test(next) && next !== '$') {
        let cursor = index + 1;
        let found = -1;
        while (cursor < text.length) {
          const current = text[cursor] ?? '';
          if (current === '\n') break;
          if (current === '$' && text[cursor - 1] !== '\\') {
            const after = text[cursor + 1] ?? '';
            if (!/\d/.test(after)) found = cursor;
            break;
          }
          cursor += 1;
        }
        if (found > index + 1) {
          const tex = text.slice(index + 1, found);
          if (tex.trim() && !/\s$/.test(tex)) {
            store.math.push({ tex, display: false });
            out += token(
              MARK.mathInlineStart,
              MARK.mathInlineEnd,
              store.math.length - 1,
            );
            index = found + 1;
            continue;
          }
        }
      }
    }

    out += char;
    index += 1;
  }
  return out;
}

/** 处理一行正文：行内代码原样保留，代码之外的片段再走扩展语法。 */
function transformInline(line: string, store: MarkdownStore): string {
  let out = '';
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? '';
    if (char !== '`') {
      let end = line.indexOf('`', index);
      if (end === -1) end = line.length;
      out += transformInlineText(line.slice(index, end), store);
      index = end;
      continue;
    }
    // 行内代码：找同长度的反引号串，整段原样输出
    let run = index;
    while (line[run] === '`') run += 1;
    const ticks = line.slice(index, run);
    const close = line.indexOf(ticks, run);
    if (close === -1) {
      out += line.slice(index);
      break;
    }
    out += line.slice(index, close + ticks.length);
    index = close + ticks.length;
  }
  return out;
}

interface FenceState {
  char: string;
  length: number;
}

/**
 * 块级预处理：抽取提醒框、图片网格、GitHub 卡片和块级公式；
 * 跳过围栏代码，其余行处理行内扩展语法。
 */
function preprocess(markdown: string, store: MarkdownStore): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let fence: FenceState | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    // 围栏代码：内部完全原样保留
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      out.push(line);
      if (
        fenceMatch &&
        (fenceMatch[1]?.[0] ?? '') === fence.char &&
        (fenceMatch[1]?.length ?? 0) >= fence.length
      ) {
        fence = null;
      }
      index += 1;
      continue;
    }
    if (fenceMatch) {
      fence = {
        char: fenceMatch[1]?.[0] ?? '`',
        length: fenceMatch[1]?.length ?? 3,
      };
      out.push(line);
      index += 1;
      continue;
    }

    // > [!NOTE] 提醒框：收集同一层引用，内部再走完整 Markdown 渲染
    const alertMatch =
      /^ {0,3}> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/.exec(line);
    if (alertMatch) {
      const quoteLines: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const quoted = /^ {0,3}> ?(.*)$/.exec(current);
        if (quoted) {
          quoteLines.push(quoted[1] ?? '');
          index += 1;
          continue;
        }
        break;
      }
      const type = (alertMatch[1] ?? 'NOTE') as keyof typeof ALERT_LABELS;
      store.alerts.push({ type, markdown: quoteLines.join('\n') });
      out.push(
        '',
        token(MARK.alertStart, MARK.alertEnd, store.alerts.length - 1),
        '',
      );
      continue;
    }

    // [grid]…[/grid] 图片网格
    if (line.trim() === '[grid]') {
      const cells: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        (lines[index] ?? '').trim() !== '[/grid]'
      ) {
        cells.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      store.grids.push(cells.join('\n'));
      out.push(
        '',
        token(MARK.gridStart, MARK.gridEnd, store.grids.length - 1),
        '',
      );
      continue;
    }

    // ::github{repo="owner/repo"}
    const githubMatch = /^ {0,3}::github\{repo="([^"]+)"\}[ \t]*$/.exec(line);
    if (githubMatch) {
      const repo = githubMatch[1] ?? '';
      if (/^[\w.-]+\/[\w.-]+$/.test(repo)) {
        store.github.push(repo);
        out.push(
          '',
          token(MARK.githubStart, MARK.githubEnd, store.github.length - 1),
          '',
        );
      } else {
        out.push(line);
      }
      index += 1;
      continue;
    }

    // $$ … $$ 块级公式：整段单独成块，交给 KaTeX 以 display 模式渲染
    if (/^ {0,3}\$\$/.test(line)) {
      const start = line.indexOf('$$') + 2;
      let collected = line.slice(start);
      let found = collected.indexOf('$$');
      let cursor = index;
      while (found === -1 && cursor + 1 < lines.length) {
        cursor += 1;
        collected += `\n${lines[cursor] ?? ''}`;
        found = collected.indexOf('$$');
      }
      if (found >= 0) {
        const tex = collected.slice(0, found).trim();
        if (tex) {
          store.math.push({ tex, display: true });
          out.push(
            '',
            token(
              MARK.mathBlockStart,
              MARK.mathBlockEnd,
              store.math.length - 1,
            ),
            '',
          );
          index = cursor + 1;
          continue;
        }
      }
    }

    out.push(transformInline(line, store));
    index += 1;
  }

  return out.join('\n');
}

/**
 * marked 的 GFM 任务列表会输出 `<input type="checkbox" disabled>`。
 * input 不在白名单里（正文不该出现可交互控件），先把复选框换成标记字符；
 * sanitize 之后再把标记换成展示用的小方块，交给 CSS 画。
 */
function checkboxToMarker(html: string) {
  return html.replace(/<input\b([^>]*)>\s*/gi, (match, attrs: string) => {
    if (!/\btype="checkbox"/i.test(attrs)) return match;
    return /\bchecked\b/i.test(attrs) ? TASK_DONE : TASK_TODO;
  });
}

/**
 * 把标记字符换成任务方块，并给所属 li 补 task class（CSS 用它去掉方点）。
 * 注入的结构固定、不含用户输入，放在 sanitize 之后执行是安全的。
 */
function markerToTaskBoxes(html: string) {
  return (
    html
      .replace(
        new RegExp(`<li>((?:\\s*<p>)?\\s*)${TASK_DONE}`, 'g'),
        (_match, inner: string) =>
          `<li class="task">${inner}<span class="task-box is-done"></span>`,
      )
      .replace(
        new RegExp(`<li>((?:\\s*<p>)?\\s*)${TASK_TODO}`, 'g'),
        (_match, inner: string) =>
          `<li class="task">${inner}<span class="task-box"></span>`,
      )
      // 兜底：极少数不在 li 内的标记直接清掉
      .replace(/[\uE000\uE001]/g, '')
  );
}

function sanitizeInline(markdown: string): string {
  return sanitizeHtml(
    (marked.parseInline(markdown || '') as string) ?? '',
    SANITIZE_OPTIONS,
  );
}

function renderAlert(alert: AlertBlock): string {
  const body = renderBody(alert.markdown);
  const label = ALERT_LABELS[alert.type] ?? '注意';
  return [
    `<div class="alert alert--${alert.type.toLowerCase()}">`,
    `<div class="alert-head"><span class="alert-kind">${alert.type}</span><span class="alert-label">${label}</span></div>`,
    `<div class="alert-body">${body}</div>`,
    '</div>',
  ].join('');
}

function renderGrid(markdown: string): string {
  const inner = renderBody(markdown);
  const images: string[] = inner.match(/<img\b[^>]*>/gi) ?? [];
  if (images.length === 0) return inner;
  const count = Math.min(images.length, 4);
  const cells = images.map((image) => {
    const alt = /alt="([^"]*)"/.exec(image)?.[1] ?? '';
    const caption = decodeBasicEntities(alt).trim();
    return `<figure class="image-grid-item">${image}${
      caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
    }</figure>`;
  });
  return `<div class="image-grid image-grid--${count}">${cells.join('')}</div>`;
}

function renderGithubCard(repo: string): string {
  const [owner = '', name = ''] = repo.split('/');
  return [
    `<a class="repo-card" href="https://github.com/${escapeHtml(repo)}" target="_blank" rel="noopener noreferrer" repo="${escapeHtml(repo)}">`,
    '<span class="repo-card-main">',
    '<span class="repo-card-kind">GITHUB REPO</span>',
    `<b class="repo-card-name">${escapeHtml(owner)}<span class="repo-card-slash"> / </span><span class="repo-card-repo">${escapeHtml(name)}</span></b>`,
    '</span>',
    '<span class="repo-card-stats">',
    '<span class="repo-card-stat"><span aria-hidden="true">★</span><b data-repo-stat="stars">—</b></span>',
    '<span class="repo-card-stat"><span aria-hidden="true">⑂</span><b data-repo-stat="forks">—</b></span>',
    '</span>',
    '<span class="repo-card-go">打开 →</span>',
    '</a>',
  ].join('');
}

function replaceBlockTokens(
  html: string,
  start: string,
  end: string,
  render: (index: number) => string,
): string {
  return html.replace(
    new RegExp(`<p>\\s*${start}(\\d+)${end}\\s*</p>`, 'g'),
    (_match, index: string) => render(Number(index)),
  );
}

function resolveTokens(html: string, store: MarkdownStore): string {
  let out = replaceBlockTokens(
    html,
    MARK.alertStart,
    MARK.alertEnd,
    (index) => {
      const alert = store.alerts[index];
      return alert ? renderAlert(alert) : '';
    },
  );
  out = replaceBlockTokens(out, MARK.gridStart, MARK.gridEnd, (index) =>
    renderGrid(store.grids[index] ?? ''),
  );
  out = replaceBlockTokens(out, MARK.githubStart, MARK.githubEnd, (index) =>
    renderGithubCard(store.github[index] ?? ''),
  );

  // spoiler 内部可能还有公式/嵌套 spoiler：循环替换到稳定（最多两层足够）
  for (let round = 0; round < 3; round += 1) {
    out = out.replace(
      new RegExp(`${MARK.spoilerStart}(\\d+)${MARK.spoilerEnd}`, 'g'),
      (_match, index: string) => {
        const inner = store.spoilers[Number(index)];
        if (inner === undefined) return '';
        return `<span class="spoiler" tabindex="0" role="button" aria-label="剧透内容，悬停或点击展开">${sanitizeInline(inner)}</span>`;
      },
    );
  }

  out = out.replace(
    new RegExp(
      `<p>\\s*${MARK.mathBlockStart}(\\d+)${MARK.mathBlockEnd}\\s*</p>`,
      'g',
    ),
    (_match, index: string) => {
      const math = store.math[Number(index)];
      return math
        ? `<div class="math-block">${renderMath(math.tex, true)}</div>`
        : '';
    },
  );
  out = out.replace(
    new RegExp(`${MARK.mathBlockStart}(\\d+)${MARK.mathBlockEnd}`, 'g'),
    (_match, index: string) => {
      const math = store.math[Number(index)];
      return math
        ? `<div class="math-block">${renderMath(math.tex, true)}</div>`
        : '';
    },
  );
  out = out.replace(
    new RegExp(`${MARK.mathInlineStart}(\\d+)${MARK.mathInlineEnd}`, 'g'),
    (_match, index: string) => {
      const math = store.math[Number(index)];
      return math
        ? `<span class="math-inline">${renderMath(math.tex, false)}</span>`
        : '';
    },
  );

  // 兜底：清掉没有对应内容的残留标记
  return out.replace(MARKER_RE, '');
}

/** 把格式化后的 HTML 转回普通文字（目录标签用）。 */
function tokensToPlain(html: string, store: MarkdownStore): string {
  let out = html.replace(
    new RegExp(`${MARK.mathInlineStart}(\\d+)${MARK.mathInlineEnd}`, 'g'),
    (_match, index: string) => store.math[Number(index)]?.tex ?? '',
  );
  out = out.replace(
    new RegExp(`${MARK.mathBlockStart}(\\d+)${MARK.mathBlockEnd}`, 'g'),
    (_match, index: string) => store.math[Number(index)]?.tex ?? '',
  );
  out = out.replace(
    new RegExp(`${MARK.spoilerStart}(\\d+)${MARK.spoilerEnd}`, 'g'),
    '…',
  );
  out = out.replace(
    new RegExp(`${MARK.alertStart}\\d+${MARK.alertEnd}`, 'g'),
    '',
  );
  out = out.replace(
    new RegExp(`${MARK.gridStart}\\d+${MARK.gridEnd}`, 'g'),
    '',
  );
  out = out.replace(
    new RegExp(`${MARK.githubStart}\\d+${MARK.githubEnd}`, 'g'),
    '',
  );
  return out;
}

interface Prepared {
  raw: string;
  store: MarkdownStore;
}

/** Markdown → sanitize 后的 HTML（扩展语法的结构还是占位符）。 */
function prepare(markdown: string): Prepared {
  const store = createStore();
  const source = String(markdown ?? '').replace(MARKER_RE, '');
  const preprocessed = preprocess(source, store);
  const raw = checkboxToMarker(
    marked.parse(preprocessed, { async: false }) as string,
  );
  return { raw: sanitizeHtml(raw, SANITIZE_OPTIONS), store };
}

function renderPrepared(prepared: Prepared): string {
  return markerToTaskBoxes(resolveTokens(prepared.raw, prepared.store));
}

/** 完整渲染：提醒框 / 剧透 / 公式 / 图片网格 / GitHub 卡片都已替换成组件 HTML。 */
function renderBody(markdown: string): string {
  return renderPrepared(prepare(markdown));
}

function stripTags(html: string) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** 把 Markdown 渲染成可安全插入页面的 HTML。用于文章正文与封面 README。 */
export function renderMarkdown(markdown: string): string {
  return renderBody(markdown);
}

/**
 * 文章正文开头的 h1 与页头标题重复，要剥掉。
 * 除 `# 标题` 这种 ATX 写法外，也兼容 `标题\n====` 的 Setext 写法。
 */
function stripLeadingH1(markdown: string) {
  const atx = markdown.match(/^\s*#\s+[^\n]*\n?/);
  if (atx) return markdown.slice(atx[0].length);

  const setext = markdown.match(
    /^\s*(?![#\s])[^\n]*[^\s][^\n]*\n=+[ \t]*(?:\n|$)/,
  );
  if (setext) return markdown.slice(setext[0].length);

  return markdown;
}

/**
 * 渲染文章正文：
 * - 去掉正文开头重复的 h1（标题由页面页头渲染）
 * - 给二级标题编号并注入锚点，同时收集成目录
 * - 把代码块包成设计稿里的 `.code` 卡片
 *
 * 注入的标签和属性都是本函数自己生成的固定结构（含扩展语法组件），
 * 用户输入已经过 sanitize，因此结构注入是安全的。
 */
export function renderArticle(markdown: string): {
  html: string;
  toc: TocEntry[];
} {
  const body = stripLeadingH1(markdown ?? '');
  const toc: TocEntry[] = [];
  const prepared = prepare(body);

  let raw = prepared.raw.replace(
    /<h2>([\s\S]*?)<\/h2>/g,
    (_match, inner: string) => {
      const index = toc.length + 1;
      const id = `s${index}`;
      toc.push({ id, label: stripTags(tokensToPlain(inner, prepared.store)) });
      const order = String(index).padStart(2, '0');
      return `<h2 id="${id}"><span class="n">${order}</span>${inner}</h2>`;
    },
  );

  raw = raw.replace(
    /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_match, lang: string | undefined, code: string) => {
      const name = stripTags(lang ?? '') || 'text';
      return `<div class="code"><div class="code-h"><span class="fname">${name}</span><span>CODE</span></div><pre><code>${code}</code></pre></div>`;
    },
  );

  return { html: markerToTaskBoxes(resolveTokens(raw, prepared.store)), toc };
}
