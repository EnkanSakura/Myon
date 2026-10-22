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

function sanitize(markdown: string) {
  const raw = marked.parse(markdown ?? '', { async: false }) as string;
  return sanitizeHtml(raw, {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      code: ['class'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  });
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
  const body = (markdown ?? '').replace(/^\s*#\s+[^\n]*\n?/, '');
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
    /<pre><code(?: class="language-([\w-]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_match, lang: string | undefined, code: string) => {
      const name = stripTags(lang ?? '') || 'text';
      return `<div class="code"><div class="code-h"><span class="fname">${name}</span><span>CODE</span></div><pre><code>${code}</code></pre></div>`;
    },
  );

  return { html, toc };
}
