/* Myon · 极简 Markdown 渲染（标题 / 段落 / 列表 / 引用 / 粗斜体 / 行内代码 / 链接 / 分隔线）
   只为本设计稿服务，不追求完整 CommonMark。 */
(function(){
  function esc(s){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function inline(s){
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function render(md){
    var lines = (md || '').replace(/\r/g, '').split('\n');
    var out = [], i = 0, listOpen = false;
    function closeList(){ if(listOpen){ out.push('</ul>'); listOpen = false; } }
    while(i < lines.length){
      var ln = lines[i];
      if(/^\s*$/.test(ln)){ closeList(); i++; continue; }
      var m;
      if((m = ln.match(/^\s*###\s+(.*)$/))){ closeList(); out.push('<h4>' + inline(m[1]) + '</h4>'); i++; continue; }
      if((m = ln.match(/^\s*##\s+(.*)$/))){ closeList(); out.push('<h3>' + inline(m[1]) + '</h3>'); i++; continue; }
      if((m = ln.match(/^\s*#\s+(.*)$/))){ closeList(); out.push('<h2>' + inline(m[1]) + '</h2>'); i++; continue; }
      if(/^\s*>\s+/.test(ln)){
        closeList();
        var quote = [];
        while(i < lines.length && /^\s*>\s+/.test(lines[i])){ quote.push(inline(lines[i].replace(/^\s*>\s+/, ''))); i++; }
        out.push('<blockquote>' + quote.join('<br>') + '</blockquote>');
        continue;
      }
      if(/^\s*[-*]\s+/.test(ln)){
        if(!listOpen){ out.push('<ul>'); listOpen = true; }
        out.push('<li>' + inline(ln.replace(/^\s*[-*]\s+/, '')) + '</li>');
        i++; continue;
      }
      if(/^\s*(---|\*\*\*)\s*$/.test(ln)){ closeList(); out.push('<hr>'); i++; continue; }
      closeList();
      var paras = [ln.trim()];
      i++;
      while(i < lines.length && /\S/.test(lines[i]) && !/^\s*(#|>|[-*]\s|---|\*\*\*)/.test(lines[i])){
        paras.push(lines[i].trim()); i++;
      }
      out.push('<p>' + inline(paras.join('')) + '</p>');
    }
    closeList();
    return out.join('\n');
  }
  window.MyonMarkdown = { render: render };
  window.MYON_ABOUT_DEFAULT = [
    '# 关于 Myon',
    '',
    '你好，我是 Myon。这里是我自己写、自己排的一本二次元同人志：写字、看番、存图，也做点小工具。',
    '',
    '## 最近在做什么',
    '',
    '- 把博客从 Pages + Workers + D1 + R2 重新搭了一遍，首页改成七页翻页。',
    '- 追《葬送的芙莉莲》第二季，顺手重写了追番页。',
    '- 在整理展柜里的根付，慢慢补拍摄图。',
    '',
    '## 这个站怎么来的',
    '',
    '原本只是用笔记软件记点东西，后来想要一个能自己排版的角落。现在它有文章、动态、展柜、追番、工具和后台，一共七页。',
    '',
    '> 如果哪一件你也喜欢，留言或者写邮件都行。',
    '',
    '## 技术栈',
    '',
    '`Cloudflare Pages` · `Workers` · `D1` · `R2`。前台静态页，后台是一个单人控制台。'
  ].join('\n');
})();
