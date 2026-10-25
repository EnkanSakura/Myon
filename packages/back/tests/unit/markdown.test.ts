import { describe, expect, it } from 'vitest';
import { renderArticle, renderMarkdown } from '../../src/markdown';

describe('renderMarkdown', () => {
  it('renders headings, lists and inline marks', () => {
    const html = renderMarkdown('# 标题\n\n- 一\n- **二**');
    expect(html).toContain('<h1');
    expect(html).toContain('<li>');
    expect(html).toContain('<strong>二</strong>');
  });

  it('renders GFM strikethrough', () => {
    const html = renderMarkdown('原价 ~~￥980~~ 现价 ￥680');
    expect(html).toContain('<del>￥980</del>');
  });

  it('renders ordered lists, keeping the start number', () => {
    const html = renderMarkdown('3. 第三\n4. 第四');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<li>第三</li>');
  });

  it('renders GFM task lists without leaving an input element', () => {
    const html = renderMarkdown('- [ ] 待办\n- [x] 已完成');
    expect(html).not.toContain('<input');
    expect(html).toContain(
      '<li class="task"><span class="task-box"></span>待办</li>',
    );
    expect(html).toContain(
      '<li class="task"><span class="task-box is-done"></span>已完成</li>',
    );
  });

  it('renders GFM tables with alignment attributes', () => {
    const html = renderMarkdown(
      '| 左 | 中 | 右 |\n| :- | :-: | -: |\n| 1 | 2 | 3 |',
    );
    expect(html).toContain('<table>');
    expect(html).toContain('<th align="left">左</th>');
    expect(html).toContain('<th align="center">中</th>');
    expect(html).toContain('<td align="right">3</td>');
  });

  it('renders images, inline code and autolinks', () => {
    const html = renderMarkdown(
      '![图](/media/test.png "标题")\n\n`code`\n\nhttps://example.com',
    );
    expect(html).toContain(
      '<img src="/media/test.png" alt="图" title="标题" />',
    );
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://example.com"');
  });

  it('keeps GFM line breaks and nested emphasis', () => {
    expect(renderMarkdown('a  \nb')).toContain('<br />');
    expect(renderMarkdown('**粗 *斜***')).toContain(
      '<strong>粗 <em>斜</em></strong>',
    );
  });

  it('strips scripts and unsafe attributes', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n[点我](javascript:alert(1))',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
  });

  it('does not open up raw inline html beyond the whitelist', () => {
    const html = renderMarkdown('<span class="x">raw</span>');
    expect(html).not.toContain('<span');
    expect(html).toContain('raw');
  });
});

describe('renderArticle', () => {
  it('drops the duplicated h1 so the page header owns the title', () => {
    const { html } = renderArticle('# 文章标题\n\n正文第一段。');
    expect(html).not.toContain('<h1');
    expect(html).toContain('正文第一段。');
  });

  it('drops a setext-style h1 as well', () => {
    const { html } = renderArticle('文章标题\n=====\n\n正文第一段。');
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

  it('wraps fenced code whose language has symbols (c++, c#)', () => {
    const { html } = renderArticle('```c++\nint a = 1;\n```');
    expect(html).toContain('<div class="code">');
    expect(html).toContain('<span class="fname">c++</span>');
  });

  it('keeps task lists and deeper headings in article bodies', () => {
    const { html } = renderArticle(
      '- [x] 已完成\n\n#### 四级标题\n\n##### 五级标题',
    );
    expect(html).toContain('<li class="task">');
    expect(html).toContain('<h4>四级标题</h4>');
    expect(html).toContain('<h5>五级标题</h5>');
  });
});
