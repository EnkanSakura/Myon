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

  it('renders inline and block LaTeX with KaTeX', () => {
    const html = renderMarkdown(
      '质能方程 $E=mc^2$\n\n$$\n\\int_0^1 x\\,dx\n$$',
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).toContain('math-inline');
    expect(html).toContain('math-block');
  });

  it('keeps prices and inline code away from math', () => {
    expect(renderMarkdown('价格 $5 和 $10')).not.toContain('class="katex"');
    expect(renderMarkdown('`$x$`')).not.toContain('class="katex"');
    expect(renderMarkdown('```\n$x$\n```')).not.toContain('class="katex"');
  });

  it('renders GitHub style alert callouts', () => {
    const html = renderMarkdown(
      '> [!NOTE]\n> 这是一条 **注意**。\n\n> [!WARNING]\n> 小心',
    );
    expect(html).toContain('<div class="alert alert--note">');
    expect(html).toContain('<div class="alert alert--warning">');
    expect(html).toContain('<span class="alert-kind">NOTE</span>');
    expect(html).toContain('<span class="alert-label">注意</span>');
    expect(html).toContain('<strong>注意</strong>');
    expect(html).not.toContain('[!NOTE]');
  });

  it('renders spoilers with inline markdown kept', () => {
    const html = renderMarkdown('内容 :spoiler[被隐藏了 **哈哈**]！');
    expect(html).toContain('class="spoiler"');
    expect(html).toContain('<strong>哈哈</strong>');
    expect(html).not.toContain(':spoiler[');
  });

  it('sanitizes spoiler content', () => {
    const html = renderMarkdown(':spoiler[<script>alert(1)</script>]');
    expect(html).not.toContain('<script');
  });

  it('renders [grid] images with captions', () => {
    const html = renderMarkdown(
      '[grid]\n![图一](/media/a.png)\n![图二](/media/b.png "标题")\n[/grid]',
    );
    expect(html).toContain('<div class="image-grid image-grid--2">');
    expect(html).toContain('<figure class="image-grid-item">');
    expect(html).toContain('<figcaption>图一</figcaption>');
    expect(html).toContain('<figcaption>图二</figcaption>');
  });

  it('renders GitHub repository cards', () => {
    const html = renderMarkdown('::github{repo="CuteLeaf/Firefly"}');
    expect(html).toContain('<a class="repo-card"');
    expect(html).toContain('href="https://github.com/CuteLeaf/Firefly"');
    expect(html).toContain('repo="CuteLeaf/Firefly"');
    expect(html).toContain('repo-card-name');
  });

  it('leaves invalid repo syntax and raw urls untouched', () => {
    const invalid = renderMarkdown('::github{repo="not-a-repo"}');
    expect(invalid).toContain('::github{repo="not-a-repo"}');
    expect(invalid).not.toContain('class="repo-card"');
  });

  it('keeps extended syntax inside code fences literal', () => {
    const html = renderMarkdown(
      '```\n> [!NOTE]\n> :spoiler[x]\n::github{repo="a/b"}\n```',
    );
    expect(html).not.toContain('alert--note');
    expect(html).not.toContain('class="spoiler"');
    expect(html).not.toContain('class="repo-card"');
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

  it('builds toc labels for headings that contain math or spoilers', () => {
    const { toc } = renderArticle('## 公式 $E=mc^2$\n\n## 剧透 :spoiler[秘密]');
    expect(toc[0]?.label).toBe('公式 E=mc^2');
    expect(toc[1]?.label).toBe('剧透 …');
  });

  it('renders extended components inside article bodies', () => {
    const { html } = renderArticle(
      '> [!TIP]\n> 正文提醒\n\n[grid]\n![图](/media/a.png)\n[/grid]\n\n:spoiler[剧透]',
    );
    expect(html).toContain('alert alert--tip');
    expect(html).toContain('image-grid image-grid--1');
    expect(html).toContain('class="spoiler"');
  });
});
