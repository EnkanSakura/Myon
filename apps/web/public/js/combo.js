/* Myon · 共享选择组件 MyonCombo
   public/ 不经过打包，必须是纯 ES5 IIFE，不依赖第三方库。

   两种用法：
   1) attach：把「输入框 + 自绘列表」接成组合框（分类候选、可新建）
      var combo = window.MyonCombo.attach({
        input: "fCategory", list: "catList", toggle: "fCategoryToggle",
        getOptions: function () { return ["随笔", "技术"]; }
      });
      返回 { open, close, refresh }。选项可以是字符串，也可以是 { value, label }。

   2) 自动增强原生 <select>：脚本加载后会把页面里所有 select 换成 MyonCombo 外观，
      原生 select 保留在 DOM（visibility:hidden）用于表单值与页面原有 change 逻辑：
        <select id="fStatus"><option value="draft">草稿</option>…</select>
      页面 JS 继续读写 select.value、监听 change 即可；选项变化 / 主题切换 / 响应式
      尺寸变化会自动同步外观。动态插入的 select 也会通过 MutationObserver 自动增强。

   样式在 public/css/combo.css；后台与前台都通过布局引入，不按页面重复定义。 */
(function () {
  "use strict";

  function resolve(value) {
    if (!value) return null;
    if (typeof value !== "string") return value;
    return document.getElementById(value) || document.querySelector(value);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /* ---------------- 组合框：输入 + 自绘列表 ---------------- */

  function attach(options) {
    options = options || {};
    var input = resolve(options.input);
    var list = resolve(options.list);
    if (!input || !list) return null;

    var toggle = resolve(options.toggle);
    var filterable = options.filterable !== false;
    var allowCreate = options.allowCreate !== false && filterable;
    var readOnly = options.readOnly === true;
    var silentInput = options.silentInput === true;
    var emptyText = options.emptyText || "没有可选值，直接输入新内容";
    var activeIndex = -1;
    var suppressFocusOpen = false;

    if (readOnly) input.readOnly = true;
    if (input.classList && !input.classList.contains("combo-input")) {
      input.classList.add("combo-input");
    }
    if (!list.id && input.id) list.id = input.id + "-list";
    if (list.id) input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");
    if (toggle) toggle.setAttribute("aria-expanded", "false");

    function rawOptions() {
      var source =
        typeof options.getOptions === "function" ? options.getOptions() : [];
      var seen = {};
      var out = [];
      (source || []).forEach(function (entry) {
        var value;
        var label;
        if (entry && typeof entry === "object") {
          value = entry.value == null ? "" : String(entry.value);
          label = entry.label == null ? value : String(entry.label);
        } else {
          value = String(entry == null ? "" : entry);
          label = value;
        }
        if (!value && !label) return;
        var key = value + "\u0000" + label;
        if (seen[key]) return;
        seen[key] = true;
        out.push({ value: value, label: label });
      });
      return out;
    }

    function items() {
      return Array.prototype.slice.call(list.querySelectorAll(".combo-item"));
    }

    function setActive(index) {
      var all = items();
      if (!all.length) return;
      var next = index;
      if (next < 0) next = all.length - 1;
      if (next >= all.length) next = 0;
      activeIndex = next;
      all.forEach(function (item, i) {
        item.classList.toggle("is-active", i === next);
      });
      input.setAttribute("aria-activedescendant", all[next].id);
      if (all[next].scrollIntoView) {
        all[next].scrollIntoView({ block: "nearest" });
      }
    }

    function focusInput(keepClosed) {
      var already = document.activeElement === input;
      if (keepClosed && !already) suppressFocusOpen = true;
      input.focus();
    }

    function choose(value) {
      var found = null;
      rawOptions().forEach(function (option) {
        if (!found && option.value === String(value)) found = option;
      });
      input.value = found ? found.label : String(value);
      close();
      if (typeof options.onSelect === "function") {
        options.onSelect(String(value), found);
      } else if (!silentInput) {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      focusInput(true);
    }

    function render(filter) {
      while (list.firstChild) list.removeChild(list.firstChild);
      var typed = filterable
        ? filter === undefined
          ? String(input.value || "").trim()
          : String(filter || "").trim()
        : "";
      var keyword = typed.toLowerCase();
      var source = rawOptions();
      var matches = source.filter(function (option) {
        if (!keyword) return true;
        return (
          option.label.toLowerCase().indexOf(keyword) >= 0 ||
          option.value.toLowerCase().indexOf(keyword) >= 0
        );
      });

      matches.forEach(function (option, index) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "combo-item";
        item.id = (input.id || "combo") + "-opt-" + index;
        item.setAttribute("role", "option");
        item.setAttribute("data-value", option.value);
        item.appendChild(el("span", "combo-item-label", option.label));
        item.addEventListener("mousedown", function (event) {
          event.preventDefault();
        });
        item.addEventListener("click", function () {
          choose(option.value);
        });
        list.appendChild(item);
      });

      var hasTypedExact = source.some(function (option) {
        return option.value === typed || option.label.toLowerCase() === keyword;
      });
      if (allowCreate && typed && !hasTypedExact) {
        var create = document.createElement("button");
        create.type = "button";
        create.className = "combo-item combo-item--create";
        create.setAttribute("role", "option");
        create.setAttribute("data-value", typed);
        create.appendChild(
          el("span", "combo-item-label", "使用「" + typed + "」"),
        );
        create.appendChild(el("span", "combo-item-en", "NEW"));
        create.addEventListener("mousedown", function (event) {
          event.preventDefault();
        });
        create.addEventListener("click", function () {
          choose(typed);
        });
        list.appendChild(create);
      }

      if (!list.firstChild) {
        list.appendChild(el("p", "combo-empty", emptyText));
      }
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
    }

    function showList(filtered) {
      render(filtered ? undefined : "");
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
    }

    function open() {
      showList(false);
    }

    function close() {
      list.hidden = true;
      activeIndex = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }

    input.addEventListener("focus", function () {
      if (suppressFocusOpen) {
        suppressFocusOpen = false;
        return;
      }
      open();
    });
    input.addEventListener("input", function () {
      if (!list.hidden) render();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (list.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (list.hidden) showList(true);
        setActive(activeIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (list.hidden) showList(true);
        setActive(activeIndex - 1);
        return;
      }
      if (event.key === "Enter") {
        if (list.hidden) return;
        event.preventDefault();
        var all = items();
        if (activeIndex >= 0 && all[activeIndex]) all[activeIndex].click();
        else close();
        return;
      }
      if (event.key === "Tab") close();
    });

    if (toggle) {
      toggle.addEventListener("click", function () {
        if (list.hidden) {
          open();
          if (!readOnly) focusInput(false);
        } else {
          close();
        }
      });
    }

    document.addEventListener("click", function (event) {
      var root = input.parentNode;
      if (root && root.contains && root.contains(event.target)) return;
      if (event.target === toggle) return;
      close();
    });

    return {
      open: open,
      close: close,
      refresh: function () {
        if (!list.hidden) render();
      },
    };
  }

  /* ---------------- 原生 select → MyonCombo 外观 ---------------- */

  var SELECT_STYLE_PROPS = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "color",
    "backgroundColor",
    "borderTopWidth",
    "borderTopStyle",
    "borderTopColor",
    "borderRightWidth",
    "borderRightStyle",
    "borderRightColor",
    "borderBottomWidth",
    "borderBottomStyle",
    "borderBottomColor",
    "borderLeftWidth",
    "borderLeftStyle",
    "borderLeftColor",
    "paddingTop",
    "paddingBottom",
    "paddingLeft",
    "textAlign",
    "textTransform",
  ];

  var restyleFns = [];
  var selectSeq = 0;

  function readSelectOptions(select) {
    var out = [];
    Array.prototype.forEach.call(select.options, function (option) {
      if (option.disabled) return;
      out.push({
        value: option.value,
        label: String(option.textContent || "").trim(),
      });
    });
    return out;
  }

  function enhanceSelect(select) {
    if (!select || select.dataset.comboEnhanced === "1") return null;
    if (select.multiple || (select.size && select.size > 1)) return null;
    var parent = select.parentElement;
    if (!parent) return null;

    var parentStyle = getComputedStyle(parent);
    if (parentStyle.display === "contents") return null;

    select.dataset.comboEnhanced = "1";
    selectSeq += 1;

    var overlay = el("span", "combo combo-select");
    var input = el("input", "combo-input combo-select-input");
    input.type = "text";
    input.readOnly = true;
    input.autocomplete = "off";
    input.spellcheck = false;
    if (select.id) input.id = select.id + "-combo";
    // 把原 select 的类名带到替身输入框上（如 .p-in），页面校验/状态样式能继续命中
    String(select.className || "")
      .split(/\s+/)
      .forEach(function (name) {
        if (name) input.classList.add(name);
      });

    var toggle = el("button", "combo-toggle");
    toggle.type = "button";
    toggle.tabIndex = -1;
    toggle.setAttribute("aria-label", "展开选项");

    var list = el("span", "combo-list");
    list.hidden = true;
    list.setAttribute("role", "listbox");
    list.id = (select.id || "select-" + selectSeq) + "-list";

    var labelEl = null;
    if (select.id) {
      var escapedId =
        window.CSS && CSS.escape ? CSS.escape(select.id) : select.id;
      labelEl = document.querySelector('label[for="' + escapedId + '"]');
    }
    var ariaLabel = select.getAttribute("aria-label");
    if (!ariaLabel && labelEl) ariaLabel = labelEl.textContent.trim();
    if (ariaLabel) input.setAttribute("aria-label", ariaLabel);

    overlay.appendChild(input);
    overlay.appendChild(toggle);
    overlay.appendChild(list);
    parent.classList.add("combo-host");
    parent.insertBefore(overlay, select.nextSibling);

    select.classList.add("combo-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    var descriptor = null;
    var proto = Object.getPrototypeOf(select);
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      proto = Object.getPrototypeOf(proto);
    }
    var originalGet = descriptor && descriptor.get;
    var originalSet = descriptor && descriptor.set;

    function syncDisplay() {
      var current = select.value;
      var found = null;
      readSelectOptions(select).forEach(function (option) {
        if (!found && option.value === current) found = option;
      });
      input.value = found ? found.label : "";
    }

    function layout() {
      var parentRect = parent.getBoundingClientRect();
      var rect = select.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        overlay.style.display = "none";
        return;
      }
      var style = getComputedStyle(parent);
      var borderLeft = parseFloat(style.borderLeftWidth) || 0;
      var borderTop = parseFloat(style.borderTopWidth) || 0;
      overlay.style.display = "";
      overlay.style.left =
        rect.left - parentRect.left - borderLeft + parent.scrollLeft + "px";
      overlay.style.top =
        rect.top - parentRect.top - borderTop + parent.scrollTop + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";
    }

    function applyStyles() {
      var style = getComputedStyle(select);
      SELECT_STYLE_PROPS.forEach(function (prop) {
        input.style[prop] = style[prop];
      });
      input.style.width = "100%";
      input.style.height = "100%";
      input.style.boxSizing = "border-box";
      input.style.margin = "0";
      input.style.appearance = "none";
      input.style.webkitAppearance = "none";
      var paddingRight = parseFloat(style.paddingRight) || 0;
      input.style.paddingRight = Math.max(paddingRight, 30) + "px";
      input.disabled = select.disabled;
      layout();
    }

    function commit(value) {
      if (originalSet) originalSet.call(select, value);
      else select.value = value;
      syncDisplay();
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    var combo = attach({
      input: input,
      list: list,
      toggle: toggle,
      getOptions: function () {
        return readSelectOptions(select);
      },
      allowCreate: false,
      filterable: false,
      readOnly: true,
      silentInput: true,
      onSelect: function (value) {
        commit(value);
      },
      emptyText: "没有可选项",
    });

    syncDisplay();
    applyStyles();

    if (labelEl) {
      labelEl.addEventListener("click", function (event) {
        event.preventDefault();
        input.focus();
        if (combo) combo.open();
      });
    }

    if (originalSet && originalGet) {
      try {
        Object.defineProperty(select, "value", {
          configurable: true,
          enumerable: true,
          get: function () {
            return originalGet.call(select);
          },
          set: function (next) {
            originalSet.call(select, next);
            syncDisplay();
          },
        });
      } catch (e) {}
    }

    if (select.options && window.MutationObserver) {
      new MutationObserver(function () {
        syncDisplay();
        applyStyles();
        if (combo) combo.refresh();
      }).observe(select, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["selected", "disabled", "value"],
      });
    }

    if (select.form) {
      select.form.addEventListener("reset", function () {
        setTimeout(syncDisplay, 0);
      });
    }

    if (parent.tagName === "LABEL") {
      parent.addEventListener("click", function (event) {
        if (overlay.contains(event.target)) return;
        event.preventDefault();
        input.focus();
        if (combo) combo.open();
      });
    }

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        applyStyles();
      }).observe(select);
    }
    window.addEventListener("resize", layout);

    restyleFns.push(applyStyles);
    return applyStyles;
  }

  function enhanceSelects(root) {
    if (!root || root.nodeType !== 1) return;
    var nodes = [];
    if (root.tagName === "SELECT") nodes.push(root);
    if (root.querySelectorAll) {
      nodes = nodes.concat(
        Array.prototype.slice.call(root.querySelectorAll("select")),
      );
    }
    nodes.forEach(enhanceSelect);
  }

  function restyleAll() {
    restyleFns.forEach(function (fn) {
      try {
        fn();
      } catch (e) {}
    });
  }

  function startAutoEnhance() {
    enhanceSelects(document.documentElement);
    if (!window.MutationObserver) return;
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes, function (node) {
          if (node.nodeType === 1) enhanceSelects(node);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
    new MutationObserver(restyleAll).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
  }

  window.MyonCombo = { attach: attach, enhanceSelects: enhanceSelects };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startAutoEnhance);
  } else {
    startAutoEnhance();
  }
})();
