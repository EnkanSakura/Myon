/* Myon · 共享分类组合框：输入框 + 自绘候选列表
   用法（public/ 不经过打包，必须是纯 ES5 IIFE，不能依赖第三方库）：

     var combo = window.MyonCombo.attach({
       input: "fCategory",          // 元素或 id / 选择器
       list: "catList",             // .combo-list（role=listbox）
       toggle: "fCategoryToggle",   // 右侧箭头按钮（可省略）
       getOptions: function () {    // 每次展开 / 输入时取当前候选（字符串数组）
         return ["随笔", "技术"];
       },
       allowCreate: true            // 输入新值时追加「使用「xxx」」行，默认 true
     });

   - 输入框自动补 `combo-input` class；列表项统一 `combo-item` 结构，样式在 admin.css。
   - 选择 / 新建后写回 input.value 并派发 input 事件，页面原有的脏状态与校验逻辑照常工作。
   - 返回 { open, close, refresh }：页面数据变化时 refresh，对话框开关时 close。
   - 键盘：↑↓ 移动、Enter 选择、Esc 收起（Esc 会阻止冒泡，避免关闭外层 dialog）、Tab 收起。
*/
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

  function attach(options) {
    options = options || {};
    var input = resolve(options.input);
    var list = resolve(options.list);
    if (!input || !list) return null;

    var toggle = resolve(options.toggle);
    var allowCreate = options.allowCreate !== false;
    var emptyText = options.emptyText || "没有可选值，直接输入新内容";
    var activeIndex = -1;
    var suppressFocusOpen = false;

    if (input.classList && !input.classList.contains("combo-input")) {
      input.classList.add("combo-input");
    }
    if (input.id && list.id) {
      input.setAttribute("aria-controls", list.id);
    }
    input.setAttribute("aria-expanded", "false");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (!list.id && input.id) list.id = input.id + "-options";

    function values() {
      var source =
        typeof options.getOptions === "function" ? options.getOptions() : [];
      var seen = {};
      var out = [];
      (source || []).forEach(function (entry) {
        var name = String(entry == null ? "" : entry).trim();
        if (!name || seen[name]) return;
        seen[name] = true;
        out.push(name);
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
      if (all[next].scrollIntoView) all[next].scrollIntoView({ block: "nearest" });
    }

    function close() {
      list.hidden = true;
      activeIndex = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }

    function showList(filtered) {
      render(filtered ? undefined : "");
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
    }

    function open() {
      // 打开时先展示全部候选；用户继续输入后再按输入过滤
      showList(false);
    }

    function focusInput(keepClosed) {
      var already = document.activeElement === input;
      if (keepClosed && !already) suppressFocusOpen = true;
      input.focus();
    }

    function choose(value) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      close();
      focusInput(true);
    }

    function render(filter) {
      while (list.firstChild) list.removeChild(list.firstChild);
      var typed =
        filter === undefined
          ? String(input.value || "").trim()
          : String(filter || "").trim();
      var keyword = typed.toLowerCase();
      var matches = values().filter(function (name) {
        return !keyword || name.toLowerCase().indexOf(keyword) >= 0;
      });
      matches.forEach(function (name, index) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "combo-item";
        item.id = (input.id || "combo") + "-opt-" + index;
        item.setAttribute("role", "option");
        item.setAttribute("data-value", name);
        item.appendChild(el("span", "combo-item-label", name));
        item.addEventListener("mousedown", function (event) {
          event.preventDefault();
        });
        item.addEventListener("click", function () {
          choose(name);
        });
        list.appendChild(item);
      });

      var exact = values().some(function (name) {
        return name.toLowerCase() === keyword;
      });
      if (allowCreate && typed && !exact) {
        var create = document.createElement("button");
        create.type = "button";
        create.className = "combo-item combo-item--create";
        create.setAttribute("role", "option");
        create.setAttribute("data-value", typed);
        create.appendChild(el("span", "combo-item-label", "使用「" + typed + "」"));
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

    input.addEventListener("focus", function () {
      if (suppressFocusOpen) {
        suppressFocusOpen = false;
        return;
      }
      open();
    });
    input.addEventListener("input", function () {
      if (!list.hidden) render();
    });    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (list.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        // 关闭状态下用 ↑↓ 唤起时按当前输入过滤（便于输入新值后选「使用…」）
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
          focusInput(false);
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
      }
    };
  }

  window.MyonCombo = { attach: attach };
})();
