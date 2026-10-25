/* Myon · 后台预览用 Markdown 渲染器（本地近似实现）
   正式页面由服务端 packages/back/src/markdown.ts（marked + sanitize-html）渲染，
   这里只负责后台「关于」页输入时的即时预览，尽量对齐 GFM 结构：
   标题 h1-h6 / 段落 / 有序无序列表 / 任务列表 / 引用 / 围栏代码块 / 表格 /
   图片 / 删除线 / 自动链接 / 反斜杠转义。
   约束：public/ 下的脚本不经过打包，必须是纯 ES5 IIFE，不能 import 依赖。
   安全：用户输入先整体转义成文本，再插入本文件生成的固定标签；
   代码块与行内代码内容只转义、不参与任何行内格式化。 */
(function(){
  'use strict';

  var BR = '\u0003'; // 段落内硬换行占位（输入里的 \u0003 会被清掉）
  var ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
  var TOKEN_RE = /\u0001(\d+)\u0002/g;

  /* ---------- 转义与文本工具 ---------- */

  function escText(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function escAttr(s){
    return escText(s).replace(/"/g, '&quot;');
  }
  function decodeBasic(s){
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }
  function trimText(s){
    return String(s == null ? '' : s).replace(/^[ \t]+|[ \t]+$/g, '');
  }
  function leadingSpaces(s){
    var n = 0;
    while (n < s.length && s.charAt(n) === ' ') n++;
    return n;
  }
  function stripIndent(s, n){
    var k = 0;
    while (k < n && s.charAt(k) === ' ') k++;
    return s.slice(k);
  }
  function unescapeMd(s){
    return String(s == null ? '' : s).replace(/\\(.)/g, '$1');
  }
  /* 只放行 http(s)/mailto 与相对地址，与服务端 sanitize-html 的 scheme 白名单一致。
     返回空串表示这个地址不可用。 */
  function safeHref(url){
    var u = String(url == null ? '' : url).trim();
    if (!u) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) {
      return /^(?:https?|mailto):/i.test(u) ? u : '';
    }
    return u;
  }
  function linkHtml(href, label){
    return '<a href="' + escAttr(href) + '" rel="noopener noreferrer">' + escText(label) + '</a>';
  }

  /* ---------- 占位符：先保护行内代码/转义字符，避免被后续规则二次格式化 ---------- */

  function expandTokens(html, tokens, depth){
    if (depth > 8) return html;
    return String(html).replace(TOKEN_RE, function(match, index){
      var value = tokens[Number(index)];
      return expandTokens(value == null ? '' : value, tokens, depth + 1);
    });
  }

  /* ---------- 行内渲染 ---------- */

  /* 链接/图片的目标地址：不允许空格，允许一层成对括号（如维基的 A_(b)）。 */
  var DEST = '((?:[^\\s()<>]|\\([^\\s()<>]*\\))+)';

  function inline(text, ctx){
    ctx = ctx || {};
    var tokens = ctx.tokens || [];
    var depth = ctx.depth || 0;
    var inLink = !!ctx.inLink;

    function hold(html){
      tokens.push(html);
      return '\u0001' + (tokens.length - 1) + '\u0002';
    }

    var s = String(text == null ? '' : text);
    if (depth > 8) return escText(s);

    // 1) 行内代码：内容整体转义，不再参与其它行内规则
    s = s.replace(/(`+)([\s\S]*?)\1/g, function(match, ticks, code){
      var body = code;
      if (/^ [\s\S]* $/.test(body) && !/^ +$/.test(body)) body = body.slice(1, -1);
      return hold('<code>' + escText(body) + '</code>');
    });

    // 2) 反斜杠转义：转义字符先占位，避免被当成语法
    s = s.replace(/\\([\s\S])/g, function(match, ch){
      return ESCAPABLE.indexOf(ch) >= 0 ? hold(escText(ch)) : match;
    });

    // 3) 图片（要先于链接处理，否则开头的 ! 会被落下）
    s = s.replace(new RegExp('!\\[([^\\]]*)\\]\\(\\s*' + DEST + '(?:\\s+(?:"([^"]*)"|\'([^\']*)\'))?\\s*\\)', 'g'),
      function(match, alt, src, titleA, titleB){
        var href = safeHref(src);
        var altText = textOf(alt, tokens, depth);
        var title = titleA != null ? titleA : titleB;
        var out = '<img' + (href ? ' src="' + escAttr(href) + '"' : '') + ' alt="' + escAttr(altText) + '"';
        if (title) out += ' title="' + escAttr(unescapeMd(title)) + '"';
        return hold(out + ' />');
      });

    // 4) 链接
    s = s.replace(new RegExp('\\[([^\\]]*)\\]\\(\\s*' + DEST + '(?:\\s+(?:"([^"]*)"|\'([^\']*)\'))?\\s*\\)', 'g'),
      function(match, label, href, titleA, titleB){
        var url = safeHref(href);
        var inner = inline(label, { tokens: tokens, depth: depth + 1, inLink: true });
        var title = titleA != null ? titleA : titleB;
        // 不安全的地址：和服务端 sanitize-html 一样只保留 <a> 壳、去掉 href
        var out = '<a' + (url ? ' href="' + escAttr(url) + '"' : '');
        if (title) out += ' title="' + escAttr(unescapeMd(title)) + '"';
        return hold(out + ' rel="noopener noreferrer">' + inner + '</a>');
      });

    // 5) 自动链接：尖括号写法和 GFM 裸链接
    if (!inLink) {
      s = s.replace(/<((?:https?:\/\/|mailto:)[^<>\s]+)>/g, function(match, url){
        var href = safeHref(url);
        if (!href) return match;
        return hold(linkHtml(href, /^mailto:/i.test(url) ? url.replace(/^mailto:/i, '') : url));
      });
      s = s.replace(/<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)>/g, function(match, mail){
        return hold(linkHtml('mailto:' + mail, mail));
      });
      // 裸链接：前面不能紧贴字母数字；地址主体只吃 ASCII，中文标点留给正文
      // （服务端 marked 会把紧跟在地址后的中文百分号编码进 href，这里不跟）
      s = s.replace(/(^|[^A-Za-z0-9])((?:https?:\/\/|www\.)[A-Za-z0-9._~:\/?#\[\]@!$&'()*+,;=%-]+)/g, function(match, pre, raw){
        var url = trimAutoUrl(raw);
        if (!url) return match;
        var href = /^www\./i.test(url) ? 'http://' + url : url;
        return pre + hold(linkHtml(href, url));
      });
      // 裸邮箱
      s = s.replace(/(^|[^A-Za-z0-9])([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, function(match, pre, mail){
        return pre + hold(linkHtml('mailto:' + mail, mail));
      });
    }

    // 6) 先整体转义，后面的强调规则只往纯文本里插固定标签
    s = escText(s);

    // 7) 强调 / 删除线
    s = emphasis(s, hold);

    // 8) 段内硬换行占位 → <br />，最后还原所有占位符
    s = s.replace(new RegExp(BR, 'g'), '<br />');
    return expandTokens(s, tokens, 0);
  }

  /* 图片 alt 只要纯文字：把标签去掉、把实体还原（服务端 marked 同样会剥掉 alt 里的行内标记）。 */
  function textOf(label, tokens, depth){
    var html = inline(label, { tokens: tokens, depth: depth + 1, inLink: true });
    return decodeBasic(html.replace(/<[^>]*>/g, ''));
  }

  /* GFM 裸链接末尾的标点不算地址；右括号只有不配对时才剥掉。 */
  function trimAutoUrl(url){
    var out = url;
    var trailing = '.,;:!?\'"';
    while (out.length && trailing.indexOf(out.charAt(out.length - 1)) >= 0) out = out.slice(0, -1);
    while (out.length && out.charAt(out.length - 1) === ')') {
      var opens = out.split('(').length - 1;
      var closes = out.split(')').length - 1;
      if (closes <= opens) break;
      out = out.slice(0, -1);
    }
    return out;
  }

  /* ---------- 强调 / 删除线 ----------
     递归处理内部内容，支持 **粗 *斜* 粗**、*斜 **粗** 斜* 这类嵌套；
     每层生成好的标签先收进占位符，避免后面的规则跨标签匹配出畸形嵌套；
     未闭合或只有空白的内容保持原样。 */
  function nonSpaceContent(inner){
    return /^\S(?:[\s\S]*\S)?$/.test(inner);
  }

  function emphasis(s, hold){
    s = s.replace(/\*\*\*([\s\S]*?)\*\*\*/g, function(match, inner){
      return nonSpaceContent(inner) ? hold('<em><strong>' + emphasis(inner, hold) + '</strong></em>') : match;
    });
    s = s.replace(/(^|[^A-Za-z0-9_])___([\s\S]*?)___(?![A-Za-z0-9_])/g, function(match, pre, inner){
      return nonSpaceContent(inner) ? pre + hold('<em><strong>' + emphasis(inner, hold) + '</strong></em>') : match;
    });
    s = s.replace(/~~([\s\S]*?)~~/g, function(match, inner){
      return nonSpaceContent(inner) ? hold('<del>' + emphasis(inner, hold) + '</del>') : match;
    });
    s = s.replace(/\*\*([\s\S]*?)\*\*/g, function(match, inner){
      return nonSpaceContent(inner) ? hold('<strong>' + emphasis(inner, hold) + '</strong>') : match;
    });
    s = s.replace(/(^|[^A-Za-z0-9_])__([\s\S]*?)__(?![A-Za-z0-9_])/g, function(match, pre, inner){
      return nonSpaceContent(inner) ? pre + hold('<strong>' + emphasis(inner, hold) + '</strong>') : match;
    });
    s = s.replace(/\*([^\s*](?:[\s\S]*?[^\s*])?)\*/g, function(match, inner){
      return hold('<em>' + emphasis(inner, hold) + '</em>');
    });
    s = s.replace(/(^|[^A-Za-z0-9_])_([^\s_](?:[\s\S]*?[^\s_])?)_(?![A-Za-z0-9_])/g, function(match, pre, inner){
      return pre + hold('<em>' + emphasis(inner, hold) + '</em>');
    });
    return s;
  }

  /* ---------- 块级解析 ---------- */

  var LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+([\s\S]*))?$/;
  var ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+([\s\S]*?))?[ \t]*$/;
  var FENCE_RE = /^ {0,3}(`{3,}|~{3,})([\s\S]*)$/;
  var THEMATIC_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
  var BLOCKQUOTE_RE = /^ {0,3}> ?([\s\S]*)$/;

  function matchList(line){
    var m = LIST_RE.exec(line);
    if (!m) return null;
    var indent = m[1].length;
    if (indent > 3) return null; // 顶层列表最多缩进 3 格
    var marker = m[2];
    var rest = m[3] == null ? '' : m[3];
    var after = line.slice(indent + marker.length);
    var spaces = 0;
    while (spaces < after.length && (after.charAt(spaces) === ' ' || after.charAt(spaces) === '\t')) spaces++;
    if (spaces < 1) spaces = 1;
    return {
      indent: indent,
      ordered: /^\d/.test(marker),
      number: /^\d/.test(marker) ? parseInt(marker, 10) : null,
      text: rest,
      contentIndent: indent + marker.length + Math.min(spaces, 4)
    };
  }

  function startsBlock(line){
    return ATX_RE.test(line) || THEMATIC_RE.test(line) || FENCE_RE.test(line) ||
      BLOCKQUOTE_RE.test(line) || !!matchList(line);
  }

  function setextLevel(line){
    if (/^ {0,3}=+[ \t]*$/.test(line)) return 1;
    if (/^ {0,3}-+[ \t]*$/.test(line)) return 2;
    return 0;
  }

  /* GFM 表格行：按未转义的 | 切分，首尾空 cell 去掉；\| 保留给行内规则还原。 */
  function splitRow(line){
    var s = trimText(line);
    var cells = [];
    var buf = '';
    var escaped = false;
    var i;
    for (i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (escaped) { buf += ch; escaped = false; continue; }
      if (ch === '\\') { buf += ch; escaped = true; continue; }
      if (ch === '|') { cells.push(buf); buf = ''; continue; }
      buf += ch;
    }
    cells.push(buf);
    if (cells.length && trimText(cells[0]) === '') cells.shift();
    if (cells.length && trimText(cells[cells.length - 1]) === '') cells.pop();
    return cells;
  }

  function tableInfo(lines, index){
    var headerLine = lines[index];
    var delimLine = lines[index + 1];
    if (headerLine == null || delimLine == null || headerLine.indexOf('|') < 0) return null;
    var head = splitRow(headerLine);
    var cells = splitRow(delimLine);
    if (!head.length || head.length !== cells.length) return null;
    var aligns = [];
    var i, cell, m;
    for (i = 0; i < cells.length; i++) {
      cell = trimText(cells[i]);
      m = /^(:)?(-+)(:)?$/.exec(cell);
      if (!m) return null;
      aligns.push(m[1] && m[3] ? 'center' : m[1] ? 'left' : m[3] ? 'right' : '');
    }
    return { header: head, aligns: aligns };
  }

  function cellHtml(tag, text, align){
    return '<' + tag + (align ? ' align="' + align + '"' : '') + '>' +
      inline(trimText(text)) + '</' + tag + '>';
  }

  function renderTable(info, rows){
    var c;
    var html = '<table>\n<thead>\n<tr>';
    for (c = 0; c < info.header.length; c++) html += cellHtml('th', info.header[c], info.aligns[c]);
    html += '</tr>\n</thead>\n<tbody>';
    for (var r = 0; r < rows.length; r++) {
      html += '\n<tr>';
      for (c = 0; c < info.header.length; c++) {
        html += cellHtml('td', rows[r][c] == null ? '' : rows[r][c], info.aligns[c]);
      }
      html += '</tr>';
    }
    return html + '\n</tbody>\n</table>';
  }

  /* 段内软换行保留成换行符（浏览器折叠为空格，和 marked 一致）；
     行尾两个空格或反斜杠是硬换行，占位后替换成 <br />（硬换行不保留换行符）。 */
  function joinParagraph(lines){
    var html = '';
    var i, raw, text;
    for (i = 0; i < lines.length; i++) {
      raw = lines[i];
      text = trimText(raw);
      if (i < lines.length - 1) {
        if (/ {2,}$/.test(raw)) { html += text + BR; continue; }
        if (/\\$/.test(raw)) { html += trimText(raw.slice(0, -1)) + BR; continue; }
        html += text + '\n';
        continue;
      }
      html += text;
    }
    return html;
  }

  function unwrapFirstParagraph(html){
    return html.replace(/^<p>([\s\S]*?)<\/p>\n?/, '$1');
  }

  function renderList(lines, start, depth){
    var first = matchList(lines[start]);
    var baseIndent = first.indent;
    var ordered = first.ordered;
    var startNumber = first.number;
    var loose = false;
    var items = [];
    var i = start;

    while (i < lines.length) {
      var m = matchList(lines[i]);
      if (!m || m.indent !== baseIndent || m.ordered !== ordered) break;
      var contentIndent = m.contentIndent;
      var body = [m.text];
      i++;
      while (i < lines.length) {
        var ln = lines[i];
        if (/^\s*$/.test(ln)) {
          var j = i;
          while (j < lines.length && /^\s*$/.test(lines[j])) j++;
          if (j >= lines.length) { i = j; break; }
          var nextItem = matchList(lines[j]);
          if (nextItem && nextItem.indent === baseIndent) {
            // 空行后还是同类型的同级项：这是一个“松列表”，保留段落包裹
            if (nextItem.ordered === ordered) loose = true;
            i = j;
            break;
          }
          var nextIndent = leadingSpaces(lines[j]);
          if (nextIndent >= contentIndent || (nextItem && nextItem.indent > baseIndent)) {
            loose = true;
            while (i < j) { body.push(''); i++; }
            continue;
          }
          i = j;
          break;
        }
        var itemLine = matchList(ln);
        if (itemLine && itemLine.indent === baseIndent) break;
        if (itemLine && itemLine.indent < baseIndent) break;
        var indent = leadingSpaces(ln);
        if (indent >= contentIndent) { body.push(stripIndent(ln, contentIndent)); i++; continue; }
        if (itemLine && itemLine.indent > baseIndent) { body.push(stripIndent(ln, baseIndent + 2)); i++; continue; }
        if (!startsBlock(ln)) { body.push(trimText(ln)); i++; continue; }
        break;
      }
      items.push({ body: body });
    }

    var html = ordered ? '<ol' : '<ul';
    if (ordered && startNumber != null && startNumber !== 1) html += ' start="' + startNumber + '"';
    html += '>\n';
    var k, item, inner, task, box;
    for (k = 0; k < items.length; k++) {
      item = items[k];
      task = /^\[([ xX])\][ \t]+([\s\S]*)$/.exec(item.body[0]);
      if (task) item.body[0] = task[2];
      inner = renderBlocks(item.body, depth + 1);
      box = task ? '<span class="task-box' + (task[1] === ' ' ? '' : ' is-done') + '"></span>' : '';
      if (task) {
        if (loose) {
          inner = /^<p>/.test(inner) ? inner.replace(/^<p>/, '<p>' + box) : box + inner;
        } else {
          inner = box + unwrapFirstParagraph(inner);
        }
      } else if (!loose) {
        inner = unwrapFirstParagraph(inner);
      }
      html += '<li' + (task ? ' class="task"' : '') + '>' + inner + '</li>\n';
    }
    return { html: html + (ordered ? '</ol>' : '</ul>'), next: i };
  }

  function renderBlocks(lines, depth){
    depth = depth || 0;
    if (depth > 8) return '<p>' + inline(lines.join('\n')) + '</p>';
    var out = [];
    var i = 0;
    var ln, m, fence, table, row;

    while (i < lines.length) {
      ln = lines[i];
      if (/^\s*$/.test(ln)) { i++; continue; }

      // 围栏代码块：内容只转义，语言名取 info 的第一个词
      fence = FENCE_RE.exec(ln);
      if (fence && !(fence[1].charAt(0) === '`' && fence[2].indexOf('`') >= 0)) {
        var fenceChar = fence[1].charAt(0);
        var fenceLen = fence[1].length;
        var fenceIndent = leadingSpaces(ln);
        var lang = trimText(fence[2]) ? trimText(fence[2]).split(/\s+/)[0] : '';
        var codeLines = [];
        var closed = false;
        var j = i + 1;
        while (j < lines.length) {
          var close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[j]);
          if (close && close[1].charAt(0) === fenceChar && close[1].length >= fenceLen) { closed = true; break; }
          codeLines.push(stripIndent(lines[j], fenceIndent));
          j++;
        }
        i = closed ? j + 1 : j;
        var codeText = codeLines.join('\n');
        if (codeLines.length) codeText += '\n';
        out.push('<pre><code' + (lang ? ' class="language-' + escAttr(lang) + '"' : '') + '>' +
          escText(codeText) + '</code></pre>');
        continue;
      }

      // ATX 标题：1-6 级原样输出，末尾的 ### 收尾符去掉
      m = ATX_RE.exec(ln);
      if (m) {
        var level = m[1].length;
        var headText = m[2] == null ? '' : trimText(m[2].replace(/[ \t]+#+[ \t]*$/, ''));
        out.push('<h' + level + '>' + inline(headText) + '</h' + level + '>');
        i++;
        continue;
      }

      // 分隔线
      if (THEMATIC_RE.test(ln)) { out.push('<hr>'); i++; continue; }

      // GFM 表格
      table = tableInfo(lines, i);
      if (table) {
        var rows = [];
        row = i + 2;
        while (row < lines.length && !/^\s*$/.test(lines[row]) && lines[row].indexOf('|') >= 0) {
          rows.push(splitRow(lines[row]));
          row++;
        }
        out.push(renderTable(table, rows));
        i = row;
        continue;
      }

      // 引用：剥掉一层 > 后递归渲染，支持引用里的标题/列表/段落
      if (BLOCKQUOTE_RE.test(ln)) {
        var quote = [];
        var qm;
        while (i < lines.length && (qm = BLOCKQUOTE_RE.exec(lines[i]))) {
          quote.push(qm[1]);
          i++;
        }
        // 惰性续行：引用段落里没有 > 的普通行
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines[i])) {
          quote.push(trimText(lines[i]));
          i++;
        }
        out.push('<blockquote>\n' + renderBlocks(quote, depth + 1) + '\n</blockquote>');
        continue;
      }

      // 有序 / 无序 / 任务列表
      m = matchList(ln);
      if (m) {
        var listResult = renderList(lines, i, depth);
        out.push(listResult.html);
        i = listResult.next;
        continue;
      }

      // 段落；下一行是 === / --- 时升级成 Setext 标题
      var buf = [ln];
      i++;
      var setext = 0;
      while (i < lines.length) {
        if (/^\s*$/.test(lines[i])) break;
        setext = setextLevel(lines[i]);
        if (setext) { i++; break; }
        if (tableInfo(lines, i)) break;
        if (startsBlock(lines[i])) break;
        buf.push(lines[i]);
        i++;
      }
      var para = inline(joinParagraph(buf));
      out.push(setext ? '<h' + setext + '>' + para + '</h' + setext + '>' : '<p>' + para + '</p>');
    }
    return out.join('\n');
  }

  function render(md){
    var text = md == null ? '' : String(md);
    text = text.replace(/[\u0000\u0003]/g, '').replace(/\r\n?/g, '\n');
    return renderBlocks(text.split('\n'), 0);
  }

  window.MyonMarkdown = { render: render };
})();
