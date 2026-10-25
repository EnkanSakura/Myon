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

export interface TocEntry {
  /** 注入到 h2 上的锚点 id，形如 s1 / s2。 */
  id: string;
  /** 去标签后的标题文字，供目录直接渲染。 */
  label: string;
}

// GFM 任务列表的 checkbox 用私有区字符打标，白名单过滤后再换成展示方块。
// 这样 input 不会被放进白名单，也不会给作者开放 span。
const TASK_TODO = '\uE000';
const TASK_DONE = '\uE001';

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

function sanitize(markdown: string) {
  const raw = checkboxToMarker(
    marked.parse(markdown ?? '', { async: false }) as string,
  );
  const clean = sanitizeHtml(raw, {
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
  });

  return markerToTaskBoxes(clean);
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
  return sanitize(markdown);
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
 * 注入的标签和属性都是本函数自己生成的固定结构，不含用户输入，
 * 因此放在 sanitize 之后执行是安全的。
 */
export function renderArticle(markdown: string): {
  html: string;
  toc: TocEntry[];
} {
  const body = stripLeadingH1(markdown ?? '');
  const toc: TocEntry[] = [];

  let html = sanitize(body).replace(
    /<h2>([\s\S]*?)<\/h2>/g,
    (_match, inner: string) => {
      const index = toc.length + 1;
      const id = `s${index}`;
      toc.push({ id, label: stripTags(inner) });
      const order = String(index).padStart(2, '0');
      return `<h2 id="${id}"><span class="n">${order}</span>${inner}</h2>`;
    },
  );

  html = html.replace(
    /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_match, lang: string | undefined, code: string) => {
      const name = stripTags(lang ?? '') || 'text';
      return `<div class="code"><div class="code-h"><span class="fname">${name}</span><span>CODE</span></div><pre><code>${code}</code></pre></div>`;
    },
  );

  return { html, toc };
}
