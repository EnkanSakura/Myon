import { describe, expect, it } from 'vitest';
import { renderArticle, renderMarkdown } from '../../src/markdown';

describe('renderMarkdown', () => {
  it('renders headings, lists and inline marks', () => {
    const html = renderMarkdown('# 标题\n\n- 一\n- **二**');
    expect(html).toContain('<h1');
    expect(html).toContain('<li>');
    expect(html).toContain('<strong>二</strong>');
  });

  it('strips scripts and unsafe attributes', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n[点我](javascript:alert(1))',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
  });
});

describe('renderArticle', () => {
  it('drops the duplicated h1 so the page header owns the title', () => {
    const { html } = renderArticle('# 文章标题\n\n正文第一段。');
    expect(html).not.toContain('<h1');
    expect(html).toContain('正文第一段。');
  });

  it('numbers h2 sections, adds anchors and builds the toc', () => {
    const { html, toc } = renderArticle(
      '## 第一节\n\ntext\n\n## 第二节\n\ntext',
    );
    expect(html).toContain('<h2 id="s1"><span class="n">01</span>第一节</h2>');
    expect(html).toContain('<h2 id="s2"><span class="n">02</span>第二节</h2>');
    expect(toc).toEqual([
      { id: 's1', label: '第一节' },
      { id: 's2', label: '第二节' },
    ]);
  });

  it('wraps fenced code in the designed code card', () => {
    const { html } = renderArticle('```ts\nconst a = 1;\n```');
    expect(html).toContain('<div class="code">');
    expect(html).toContain('<span class="fname">ts</span>');
    expect(html).toContain('<pre><code>');
  });
});
