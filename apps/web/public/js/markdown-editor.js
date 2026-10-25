(function () {
  "use strict";

  /* ==========================================================================
     Myon · 后台共享 Markdown 编辑器
     - 在 textarea 上方自动插入快捷工具栏（加粗 / 斜体 / 删除线 / 行内代码 /
       标题 / 引用 / 列表 / 任务 / 代码块 / 链接 / 图片 / 分隔线）
     - 编辑后派发 textarea 的 input 事件（页面已有的字数、脏状态逻辑照常工作）
     - 预览：about 模式用 MyonMarkdown.render()，article 模式用
       MyonMarkdown.renderArticle()（去 h1、h2 编号、代码块卡片，对齐前台正文）
     - 图片按钮复用 MyonMediaPicker（现有 R2 图片 + 上传）

     用法：
       MyonMarkdownEditor.mount({
         textarea: "#mdInput",
         preview: "#mdPreview",
         mode: "about" | "article",
         media: { api, gifApi, base }   // 可省略；省略时「图片」按钮禁用
       })  ->  { render(), focus() }
     ========================================================================== */

  var TOOL_GROUPS = [
    [
      { act: "bold", label: "B", title: "加粗（**文字**）" },
      { act: "italic", label: "I", title: "斜体（*文字*）" },
      { act: "strike", label: "S", title: "删除线（~~文字~~）" },
      { act: "code", label: "</>", title: "行内代码（`代码`）" }
    ],
    [
      { act: "h2", label: "H2", title: "二级标题（## 标题）" },
      { act: "h3", label: "H3", title: "三级标题（### 标题）" }
    ],
    [
      { act: "quote", label: "引用", title: "引用（> 文字）" },
      { act: "ul", label: "• 列表", title: "无序列表（- 条目）" },
      { act: "ol", label: "1. 列表", title: "有序列表（1. 条目）" },
      { act: "task", label: "☐ 任务", title: "任务列表（- [ ] 条目）" }
    ],
    [
      { act: "codeblock", label: "代码块", title: "插入围栏代码块（```）" },
      { act: "link", label: "链接", title: "插入链接（[文字](地址)）" },
      { act: "image", label: "图片", title: "从媒体库插入图片" },
      { act: "hr", label: "—", title: "分隔线（---）" }
    ]
  ];

  function resolve(value) {
    if (!value) return null;
    if (typeof value === "string") return document.querySelector(value);
    return value;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function buildToolbar(hasPicker) {
    var bar = el("div", "md-toolbar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Markdown 快捷工具栏");
    TOOL_GROUPS.forEach(function (group, groupIndex) {
      if (groupIndex > 0) {
        var sep = el("span", "md-tool-sep");
        sep.setAttribute("aria-hidden", "true");
        bar.appendChild(sep);
      }
      group.forEach(function (item) {
        var btn = el("button", "md-tool", item.label);
        btn.type = "button";
        btn.setAttribute("data-md-act", item.act);
        btn.setAttribute("title", item.title);
        btn.setAttribute("aria-label", item.title);
        if (item.act === "image" && !hasPicker) {
          btn.disabled = true;
          btn.title = "媒体选择器未加载";
        }
        bar.appendChild(btn);
      });
    });
    return bar;
  }

  function mount(options) {
    options = options || {};
    var textarea = resolve(options.textarea);
    var preview = resolve(options.preview);
    if (!textarea) {
      throw new Error("MyonMarkdownEditor.mount: textarea 不存在");
    }

    var mode = options.mode === "article" ? "article" : "about";
    var media = options.media || {};
    var picker = window.MyonMediaPicker && media.api ? window.MyonMediaPicker : null;
    var toolbar = buildToolbar(!!picker);
    if (textarea.parentNode) {
      textarea.parentNode.insertBefore(toolbar, textarea);
    }

    var renderTimer = null;
    var savedRange = null;

    function value() {
      return textarea.value || "";
    }

    function caret() {
      return {
        start: textarea.selectionStart || 0,
        end: textarea.selectionEnd || 0
      };
    }

    function focusRange(start, end) {
      textarea.focus();
      textarea.setSelectionRange(start, end);
    }

    function fireInput() {
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function replaceRange(start, end, text, selectStart, selectEnd) {
      var current = value();
      textarea.value = current.slice(0, start) + text + current.slice(end);
      focusRange(selectStart, selectEnd);
      fireInput();
    }

    function wrapSelection(prefix, suffix, placeholder) {
      var range = caret();
      var selected = value().slice(range.start, range.end);
      var inner = selected || placeholder || "";
      var text = prefix + inner + suffix;
      var innerStart = range.start + prefix.length;
      replaceRange(range.start, range.end, text, innerStart, innerStart + inner.length);
    }

    function lineBlockPrefix(prefix) {
      var range = caret();
      var current = value();
      var from = current.lastIndexOf("\n", range.start - 1) + 1;
      var to = current.indexOf("\n", range.end);
      if (to < 0) to = current.length;
      var lines = current.slice(from, to).split("\n");
      var meaningful = lines.filter(function (line) {
        return line.trim().length > 0;
      });
      var allPrefixed = meaningful.length > 0;
      meaningful.forEach(function (line) {
        if (line.indexOf(prefix) !== 0) allPrefixed = false;
      });
      var nextLines = lines.map(function (line) {
        if (!line.trim()) return line;
        if (allPrefixed) return line.slice(prefix.length);
        return line.indexOf(prefix) === 0 ? line : prefix + line;
      });
      var nextBlock = nextLines.join("\n");
      var delta = nextBlock.length - (to - from);
      replaceRange(from, to, nextBlock, from, Math.max(from, to + delta));
    }

    function insertBlock(text, innerStart, innerEnd) {
      var range = caret();
      var current = value();
      var before = current.slice(0, range.start);
      var after = current.slice(range.end);
      var lead = before.length === 0 || /\n\n$/.test(before) ? "" : before.slice(-1) === "\n" ? "\n" : "\n\n";
      var tail = /\n$/.test(after) ? "" : "\n";
      var block = lead + text + tail;
      var start = range.start + lead.length + innerStart;
      replaceRange(range.start, range.end, block, start, range.start + lead.length + innerEnd);
    }

    function insertImage() {
      if (!picker) return;
      savedRange = caret();
      picker.open({
        mode: "insert",
        api: media.api,
        gifApi: media.gifApi || "",
        base: media.base || "/media/",
        onPick: function (item) {
          if (!item || !item.key) return;
          var range = savedRange || caret();
          var alt = String(item.filename || item.key).replace(/\.[a-z0-9]{1,8}$/i, "").replace(/[[\]()]/g, "").trim() || "图片";
          var markdown = "![" + alt + "](" + String(media.base || "/media/") + item.key + ")";
          savedRange = null;
          textarea.value = value().slice(0, range.start) + markdown + value().slice(range.end);
          focusRange(range.start + markdown.length, range.start + markdown.length);
          fireInput();
        }
      });
    }

    function act(name) {
      if (textarea.disabled || textarea.readOnly) return;
      switch (name) {
        case "bold":
          wrapSelection("**", "**", "加粗文字");
          break;
        case "italic":
          wrapSelection("*", "*", "斜体文字");
          break;
        case "strike":
          wrapSelection("~~", "~~", "删除线文字");
          break;
        case "code":
          wrapSelection("`", "`", "行内代码");
          break;
        case "h2":
          lineBlockPrefix("## ");
          break;
        case "h3":
          lineBlockPrefix("### ");
          break;
        case "quote":
          lineBlockPrefix("> ");
          break;
        case "ul":
          lineBlockPrefix("- ");
          break;
        case "ol":
          lineBlockPrefix("1. ");
          break;
        case "task":
          lineBlockPrefix("- [ ] ");
          break;
        case "codeblock":
          var fence = "```\n\n```";
          insertBlock(fence, 4, 4);
          break;
        case "link":
          var range = caret();
          var selected = value().slice(range.start, range.end);
          if (selected) {
            var link = "[" + selected + "](https://)";
            var urlStart = range.start + selected.length + 3;
            replaceRange(range.start, range.end, link, urlStart, urlStart + 8);
          } else {
            var empty = "[链接文字](https://)";
            replaceRange(range.start, range.end, empty, range.start + 1, range.start + 5);
          }
          break;
        case "image":
          insertImage();
          break;
        case "hr":
          insertBlock("---\n", 0, 0);
          break;
        default:
          break;
      }
    }

    function renderPreview() {
      if (!preview) return;
      var md = value();
      var renderer = window.MyonMarkdown;
      if (!renderer) {
        preview.textContent = md;
        return;
      }
      preview.innerHTML = mode === "article" && renderer.renderArticle
        ? renderer.renderArticle(md)
        : renderer.render(md);
    }

    function render() {
      clearTimeout(renderTimer);
      renderTimer = null;
      renderPreview();
    }

    textarea.addEventListener("input", function () {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(renderPreview, 140);
    });

    toolbar.addEventListener("mousedown", function (event) {
      if (event.target.closest(".md-tool")) event.preventDefault();
    });
    toolbar.addEventListener("click", function (event) {
      var btn = event.target.closest(".md-tool");
      if (!btn || btn.disabled) return;
      act(btn.getAttribute("data-md-act"));
    });

    return {
      render: render,
      focus: function () {
        textarea.focus();
      }
    };
  }

  window.MyonMarkdownEditor = { mount: mount };
})();
