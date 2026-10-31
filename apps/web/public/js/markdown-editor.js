(function () {
  "use strict";

  /* ==========================================================================
     Myon · 后台共享 Markdown 编辑器
     - 在 textarea 上方自动插入快捷工具栏（加粗 / 斜体 / 删除线 / 行内代码 /
       标题 / 引用 / 列表 / 任务 / 代码块 / 链接 / 图片 / 分隔线 /
       行内公式 / 块级公式 / 提醒框 / 剧透 / 图片网格 / GitHub 卡片）
     - 编辑后派发 textarea 的 input 事件（页面已有的字数、脏状态逻辑照常工作）
     - 预览：about 模式用 MyonMarkdown.render()，article 模式用
       MyonMarkdown.renderArticle()（去 h1、h2 编号、代码块卡片，对齐前台正文）
     - 图片按钮复用 MyonMediaPicker（现有 R2 图片 + 上传）
     - 面板头的「全屏」按钮把编辑区 + 预览区两栏一起铺满视口，Esc 退出
       （弹窗关闭时会自动退出，避免页面被锁滚动）

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
    ],
    [
      { act: "math", label: "$ 公式", title: "行内公式（$E=mc^2$）" },
      { act: "mathblock", label: "$$ 块", title: "块级公式（$$ … $$）" },
      { act: "alert", label: "提醒 ▾", title: "插入 GitHub 提醒框（可选类型）" },
      { act: "spoiler", label: "剧透", title: "剧透（:spoiler[文字]）" },
      { act: "grid", label: "网格", title: "图片网格（[grid] … [/grid]）" },
      { act: "github", label: "GitHub", title: "GitHub 仓库卡片（::github{repo=\"owner/repo\"}）" }
    ]
  ];

  /* 提醒框类型：与 GitHub 的 5 种 callout 对齐（toolbar 下拉菜单用） */
  var ALERT_TYPES = [
    { type: "NOTE", label: "注意" },
    { type: "TIP", label: "提示" },
    { type: "IMPORTANT", label: "重要" },
    { type: "WARNING", label: "警告" },
    { type: "CAUTION", label: "谨慎" }
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
        if (item.act === "alert") {
          var wrap = el("span", "md-tool-wrap");
          btn.setAttribute("aria-haspopup", "menu");
          btn.setAttribute("aria-expanded", "false");
          var menu = el("span", "md-menu");
          menu.hidden = true;
          menu.setAttribute("role", "menu");
          menu.setAttribute("aria-label", "提醒框类型");
          ALERT_TYPES.forEach(function (typeInfo) {
            var itemBtn = el("button", "md-menu-item");
            itemBtn.type = "button";
            itemBtn.setAttribute("role", "menuitem");
            itemBtn.setAttribute("data-alert-type", typeInfo.type);
            itemBtn.setAttribute("aria-label", "插入" + typeInfo.label + "提醒框（[!" + typeInfo.type + "]）");
            itemBtn.appendChild(el("span", "md-menu-label", typeInfo.label));
            itemBtn.appendChild(el("span", "md-menu-type", typeInfo.type));
            menu.appendChild(itemBtn);
          });
          wrap.appendChild(btn);
          wrap.appendChild(menu);
          bar.appendChild(wrap);
          return;
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

    /* ---------- 全屏：编辑区 + 预览区左右并排铺满视口，Esc 退出 ---------- */
    var split = textarea.closest ? textarea.closest(".md-split") : null;
    var editorPanel = textarea.closest ? textarea.closest(".md-panel") : null;
    var previewPanel =
      preview && preview.closest ? preview.closest(".md-panel") : null;
    if (previewPanel === editorPanel) previewPanel = null;
    var fsButtons = [];
    var fullscreenOn = false;
    var fsReturnFocus = null;

    function createFsButton(panel) {
      if (!split || !panel) return;
      var head = panel.querySelector(".md-panel-head");
      if (!head) return;
      var btn = el("button", "md-fs-btn", "全屏");
      btn.type = "button";
      btn.title = "编辑区 + 预览区并排全屏（Esc 退出）";
      btn.setAttribute("aria-label", "把编辑区和预览区并排放大到全屏");
      btn.setAttribute("aria-pressed", "false");
      head.appendChild(btn);
      btn.addEventListener("click", function () {
        toggleFullscreen();
      });
      fsButtons.push(btn);
    }

    function syncFullscreen() {
      if (!split) return;
      split.classList.toggle("is-fullscreen", fullscreenOn);
      fsButtons.forEach(function (btn) {
        btn.textContent = fullscreenOn ? "还原" : "全屏";
        btn.title = fullscreenOn
          ? "退出全屏（Esc）"
          : "编辑区 + 预览区并排全屏（Esc 退出）";
        btn.setAttribute("aria-pressed", fullscreenOn ? "true" : "false");
      });
      document.body.classList.toggle("md-fs-open", fullscreenOn);
    }

    function toggleFullscreen() {
      if (!split) return;
      fullscreenOn = !fullscreenOn;
      if (fullscreenOn) fsReturnFocus = document.activeElement;
      syncFullscreen();
      if (fullscreenOn) {
        if (preview) preview.scrollTop = 0;
        textarea.focus();
      } else {
        var target = fsReturnFocus;
        fsReturnFocus = null;
        if (target && typeof target.focus === "function") target.focus();
      }
    }

    function exitFullscreen(restoreFocus) {
      if (!fullscreenOn) return;
      fullscreenOn = false;
      syncFullscreen();
      var target = restoreFocus ? fsReturnFocus : null;
      fsReturnFocus = null;
      if (target && typeof target.focus === "function") target.focus();
    }

    createFsButton(editorPanel);
    createFsButton(previewPanel);

    // Esc 退出全屏：捕获阶段拦截，优先于 <dialog> 的默认关闭行为；
    // 工具栏下拉菜单展开时先交给菜单处理。
    document.addEventListener(
      "keydown",
      function (event) {
        if (event.key !== "Escape" || !fullscreenOn) return;
        if (toolbar.querySelector(".md-tool-wrap.is-open")) return;
        event.preventDefault();
        event.stopPropagation();
        exitFullscreen(true);
      },
      true
    );

    // 弹窗被关闭（取消 / 保存）时强制退出，避免页面残留 body 滚动锁
    var hostDialog = textarea.closest ? textarea.closest("dialog") : null;
    if (hostDialog) {
      hostDialog.addEventListener("cancel", function (event) {
        if (!fullscreenOn) return;
        event.preventDefault();
        exitFullscreen(true);
      });
      hostDialog.addEventListener("close", function () {
        exitFullscreen(false);
      });
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

    function insertAlert(type) {
      var upper = String(type || "NOTE").toUpperCase();
      var known = false;
      ALERT_TYPES.forEach(function (item) {
        if (item.type === upper) known = true;
      });
      if (!known) upper = "NOTE";
      var text = "> [!" + upper + "]\n> 提醒内容";
      var contentStart = text.indexOf("提醒内容");
      insertBlock(text, contentStart, contentStart + 4);
    }

    function act(name, arg) {
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
        case "math":
          wrapSelection("$", "$", "E=mc^2");
          break;
        case "mathblock":
          insertBlock("$$\n\n$$", 3, 3);
          break;
        case "alert":
          insertAlert(arg || "NOTE");
          break;
        case "spoiler":
          wrapSelection(":spoiler[", "]", "剧透内容");
          break;
        case "grid":
          insertBlock("[grid]\n\n[/grid]", 7, 7);
          break;
        case "github":
          var cardText = '::github{repo="owner/repo"}';
          var repoStart = cardText.indexOf("owner/repo");
          insertBlock(cardText, repoStart, repoStart + "owner/repo".length);
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

    // KaTeX 由页面模块脚本异步加载，到位后把已有内容重渲染一次（公式不再退回源码）
    document.addEventListener("myon:katex-ready", function () {
      renderPreview();
    });
    // 页面模块先于编辑器执行时，事件已经派发过；这里补一次首渲染。
    if (window.MyonKatex) renderPreview();

    function closeAlertMenus() {
      Array.prototype.forEach.call(
        toolbar.querySelectorAll(".md-tool-wrap.is-open"),
        function (wrap) {
          wrap.classList.remove("is-open");
          var trigger = wrap.querySelector(".md-tool");
          var menu = wrap.querySelector(".md-menu");
          if (trigger) trigger.setAttribute("aria-expanded", "false");
          if (menu) menu.hidden = true;
        }
      );
    }

    function toggleAlertMenu(trigger) {
      var wrap = trigger.parentNode;
      var menu = wrap.querySelector(".md-menu");
      if (!menu) return;
      var wasOpen = wrap.classList.contains("is-open");
      closeAlertMenus();
      if (wasOpen) {
        trigger.focus();
        return;
      }
      wrap.classList.add("is-open");
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      var first = menu.querySelector(".md-menu-item");
      if (first) first.focus();
    }

    toolbar.addEventListener("mousedown", function (event) {
      if (event.target.closest(".md-tool, .md-menu-item")) event.preventDefault();
    });
    toolbar.addEventListener("click", function (event) {
      var menuItem = event.target.closest(".md-menu-item");
      if (menuItem) {
        var alertType = menuItem.getAttribute("data-alert-type");
        closeAlertMenus();
        act("alert", alertType);
        return;
      }
      var alertTrigger = event.target.closest('.md-tool[data-md-act="alert"]');
      if (alertTrigger) {
        toggleAlertMenu(alertTrigger);
        return;
      }
      closeAlertMenus();
      var btn = event.target.closest(".md-tool");
      if (!btn || btn.disabled) return;
      act(btn.getAttribute("data-md-act"));
    });

    // 点击工具栏之外或按 Esc 收起提醒框下拉菜单
    document.addEventListener("click", function (event) {
      if (event.target.closest && event.target.closest(".md-tool-wrap")) return;
      closeAlertMenus();
    });
    document.addEventListener(
      "keydown",
      function (event) {
        if (event.key !== "Escape") return;
        var open = toolbar.querySelector(".md-tool-wrap.is-open");
        if (!open) return;
        event.preventDefault();
        event.stopPropagation();
        var trigger = open.querySelector(".md-tool");
        closeAlertMenus();
        if (trigger) trigger.focus();
      },
      true
    );

    return {
      render: render,
      focus: function () {
        textarea.focus();
      }
    };
  }

  window.MyonMarkdownEditor = { mount: mount };
})();
