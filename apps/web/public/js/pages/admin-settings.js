(function () {
  "use strict";

  /* ==========================================================================
     后台 · 设置：站点 / 首页 / 外观 / 页脚 / 尾页后记
     读取与保存都走 /api/v1/admin/settings（需要顶栏的「管理令牌」）。
     编辑 KV 里的运行时配置：站点身份、主题色、页脚、首页图片与联系方式
     （home_links）、尾页后记。首页固定文案（标题/导语/页头标签说明/数据块/
     封面贴纸便签/尾页标题导语）在 @myon/shared 的 i18n 与站点配置里，
     改文案走代码发布，本页不提供输入框。
     只有一个全局状态（页头 saveState）和一个页面级提示条（#setBanner）。
     ========================================================================== */

  /* ---------------- 常量与工具 ---------------- */
  var TOKEN_KEY = "myon-admin-token";
  var THEME_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  var RSS_RE = /^(\/|https?:\/\/)/;
  var COVER_RE = /^(\/|https?:\/\/)/;
  // 联系方式：链接协议白名单、Iconify 名称与最多条数（与 @myon/shared 的校验一致）
  var LINK_RE = /^(\/|https?:\/\/|mailto:|#)/;
  var ICON_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[-_][a-z0-9]+)*$/i;
  var HOME_LINKS_MAX = 6;

  // 图片路径字段：可以从媒体库选择，并把粘贴进来的站点域名去掉
  var IMAGE_PATH_IDS = ["homeCoverImage", "homeFigureA", "homeFigureB"];
  var IMAGE_ERR_IDS = {
    homeCoverImage: "homeCoverImageErr",
    homeFigureA: "homeFigureAErr",
    homeFigureB: "homeFigureBErr"
  };

  // 设置接口字段 → 页面输入框 id
  var FIELD_IDS = {
    site_name: "siteName",
    site_subtitle: "siteSubtitle",
    site_description: "siteDescription",
    site_author: "siteAuthor",
    footer_tech: "footerTech",
    footer_icp: "footerIcp",
    footer_rss: "footerRss",
    footer_email: "footerEmail",
    home_cover_image: "homeCoverImage",
    home_p2_figure_a: "homeFigureA",
    home_p2_figure_b: "homeFigureB",
    home_afterword_body: "homeAfterwordBody",
    home_afterword_sign: "homeAfterwordSign",
    home_afterword_next: "homeAfterwordNext"
  };

  function $(id) { return document.getElementById(id); }
  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function timeNow() {
    var d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  /* ---------------- 元素 ---------------- */
  var pageEl = document.querySelector(".page[data-api]");
  var API_URL = pageEl ? pageEl.getAttribute("data-api") : "";
  var THEME_COLOR_DEFAULT = pageEl ? pageEl.getAttribute("data-theme-color") || "" : "";
  // 图片路径的「媒体库」按钮依赖共享媒体选择器：接口与 /media/ 前缀由服务端渲染。
  var MEDIA_API = pageEl ? pageEl.getAttribute("data-api-media") || "" : "";
  var GIF_API = pageEl ? pageEl.getAttribute("data-gif-api") || "" : "";
  var MEDIA_BASE = pageEl ? pageEl.getAttribute("data-media-base") || "" : "";
  // 联系方式默认值由服务端渲染（@myon/shared 的 defaultHomeLinks），接口没返回时兜底。
  var DEFAULT_LINKS = [];
  try {
    DEFAULT_LINKS = JSON.parse((pageEl ? pageEl.getAttribute("data-home-links") : "") || "[]");
  } catch (error) {
    DEFAULT_LINKS = [];
  }
  if (!Array.isArray(DEFAULT_LINKS)) DEFAULT_LINKS = [];

  var saveBtn = $("saveBtn");
  var saveState = $("saveState");
  var toastEl = $("toast");

  var banner = $("setBanner");
  var bannerK = $("setBannerK");
  var bannerTitle = $("setBannerTitle");
  var bannerText = $("setBannerText");
  var issuesEl = $("setIssues");
  var tokenBtn = $("setTokenBtn");
  var NOTICE_TONES = ["notice--info", "notice--warn", "notice--ok", "notice--error"];

  var themeColorPick = $("themeColorPick");
  var themeColorText = $("themeColorText");
  var themeColorPreview = $("themeColorPreview");
  var themeColorErr = $("themeColorErr");

  var footerRss = $("footerRss");
  var footerRssErr = $("footerRssErr");

  var homeCoverImage = $("homeCoverImage");
  var homeCoverImageErr = $("homeCoverImageErr");
  var homeFigureA = $("homeFigureA");
  var homeFigureAErr = $("homeFigureAErr");
  var homeFigureB = $("homeFigureB");
  var homeFigureBErr = $("homeFigureBErr");

  // 联系方式行编辑器
  var homeLinksRows = $("homeLinksRows");
  var homeLinksEmpty = $("homeLinksEmpty");
  var homeLinksAdd = $("homeLinksAdd");
  var homeLinksCount = $("homeLinksCount");
  var homeLinksErr = $("homeLinksErr");

  /* ---------------- 页面状态 ---------------- */
  var state = {
    ready: false,
    saving: false,
    settings: null
  };

  /* ---------------- 提示条 ---------------- */
  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 3200);
  }

  function setNoticeTone(tone) {
    each(NOTICE_TONES, function (name) { banner.classList.remove(name); });
    banner.classList.add("notice--" + tone);
  }

  function showTokenButton(on) {
    if (!tokenBtn) return;
    tokenBtn.hidden = !on;
  }

  function showBanner(tone, title, text, issues) {
    banner.hidden = false;
    setNoticeTone(tone);
    bannerK.textContent = tone === "error" ? "ERR" : tone === "warn" ? "WARN" : "INFO";
    bannerTitle.textContent = title;
    bannerText.textContent = text || "";
    bannerText.hidden = !text;
    while (issuesEl.firstChild) issuesEl.removeChild(issuesEl.firstChild);
    if (issues && issues.length) {
      each(issues, function (issue) {
        var li = document.createElement("li");
        li.textContent = issue.path + "：" + issue.message;
        issuesEl.appendChild(li);
      });
      issuesEl.hidden = false;
    } else {
      issuesEl.hidden = true;
    }
    showTokenButton(false);
  }

  function hideBanner() {
    banner.hidden = true;
    issuesEl.hidden = true;
    showTokenButton(false);
  }

  /* ---------------- 保存状态 / 可编辑状态 ---------------- */
  function setStatus(text, isDirty) {
    saveState.textContent = text;
    saveState.classList.toggle("is-dirty", !!isDirty);
  }
  function dirty() {
    if (!state.ready) return;
    setStatus("有未保存的修改", true);
  }
  function setEditable(on) {
    each(document.querySelectorAll("[data-setting]"), function (el) {
      el.disabled = !on;
    });
    saveBtn.disabled = !on || state.saving;
    syncRowState("link");
  }

  /* ---------------- 外观：主题色 ---------------- */
  function paintColor(hex) {
    themeColorPick.value = hex.toLowerCase();
    themeColorPreview.style.background = hex;
  }
  function applyColor(value) {
    var hex = THEME_COLOR_RE.test(value) ? value.toUpperCase() : THEME_COLOR_DEFAULT;
    themeColorText.value = hex;
    paintColor(hex);
    themeColorText.closest(".fld").classList.remove("is-invalid");
    themeColorErr.hidden = true;
  }
  function syncColorFromText(showError) {
    var value = themeColorText.value.trim();
    if (THEME_COLOR_RE.test(value)) {
      paintColor(value.toUpperCase());
      themeColorText.closest(".fld").classList.remove("is-invalid");
      themeColorErr.hidden = true;
      return true;
    }
    if (showError) {
      themeColorText.closest(".fld").classList.add("is-invalid");
      themeColorErr.textContent = "主题色需要是 #RRGGBB 形式的十六进制颜色";
      themeColorErr.hidden = false;
    }
    return false;
  }

  /* ---------------- 首页图片：路径（媒体库 + 去域名） ---------------- */
  /**
   * 去掉图片路径里的站点域名：
   * - 值不是 http(s):// 或 // 开头的完整 URL（含站内 /media/ 路径）时原样返回；
   * - 同源 URL 或 pathname 以 /media/ 开头的 URL 只保留 path + query + hash；
   * - 其它外站图片 URL 原样保留，交给前台 <img> 直接加载；
   * - URL 解析失败时原样返回。
   */
  function normalizeImagePath(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!/^(https?:)?\/\//i.test(raw)) return raw;
    var url;
    try {
      url = new URL(raw, window.location.href);
    } catch (error) {
      return raw;
    }
    var sameOrigin = url.origin === window.location.origin;
    var isMediaPath = url.pathname.indexOf("/media/") === 0;
    if (!sameOrigin && !isMediaPath) return raw;
    return url.pathname + url.search + url.hash;
  }

  /** 由输入框里的 /media/<key> 反推媒体 key，用来在媒体库里高亮已选图；不是媒体路径时返回空。 */
  function keyFromImagePath(value) {
    var path = normalizeImagePath(value);
    if (!MEDIA_BASE || path.indexOf(MEDIA_BASE) !== 0) return "";
    return path.slice(MEDIA_BASE.length);
  }

  /** 清掉某个图片字段的 is-invalid 与错误文案（选图 / 改对之后调用）。 */
  function clearImageError(inputId) {
    var input = $(inputId);
    if (input) {
      var fld = input.closest(".fld");
      if (fld) fld.classList.remove("is-invalid");
    }
    var err = $(IMAGE_ERR_IDS[inputId]);
    if (!err) return;
    err.textContent = "";
    err.hidden = true;
  }

  /** 打开共享媒体选择器，选中的图片按 /media/<key> 填回对应输入框。 */
  function openImagePicker(inputId) {
    var input = $(inputId);
    if (!input) return;
    var picker = window.MyonMediaPicker;
    if (!picker || typeof picker.open !== "function") {
      toast("媒体选择器未加载，请刷新页面");
      return;
    }
    picker.open({
      mode: "pick",
      api: MEDIA_API,
      gifApi: GIF_API,
      base: MEDIA_BASE,
      selectedKey: keyFromImagePath(input.value),
      onPick: function (item) {
        if (!item || !item.key) return;
        input.value = MEDIA_BASE + item.key;
        clearImageError(inputId);
        dirty();
        toast("已从媒体库选择图片");
      }
    });
  }

  function bindImagePickers() {
    each(document.querySelectorAll("[data-media-pick]"), function (btn) {
      var inputId = btn.getAttribute("data-media-pick");
      if (!inputId || !$(inputId)) return;
      btn.addEventListener("click", function () {
        openImagePicker(inputId);
      });
    });
    // 手动粘贴 / 输入的图片链接：离开输入框时去掉同源域名
    each(IMAGE_PATH_IDS, function (inputId) {
      var input = $(inputId);
      if (!input) return;
      function normalizeField() {
        var next = normalizeImagePath(input.value);
        if (next !== input.value) input.value = next;
      }
      input.addEventListener("change", normalizeField);
      input.addEventListener("blur", normalizeField);
    });
  }

  /* ---------------- 首页：联系方式行编辑器 ---------------- */
  var rowSeq = 0;
  var dragState = null;

  function parseJsonArray(raw) {
    try {
      var value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch (e) {
      return [];
    }
  }

  function makeRowField(labelText, key, value, maxLength) {
    var fld = document.createElement("div");
    fld.className = "fld";
    var label = document.createElement("label");
    label.className = "sr-only";
    label.htmlFor = "homeLinkRow" + (++rowSeq);
    label.textContent = labelText;
    var input = document.createElement("input");
    input.type = "text";
    input.id = label.htmlFor;
    input.value = value;
    input.maxLength = maxLength;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("data-key", key);
    input.setAttribute("data-setting", "");
    input.addEventListener("input", dirty);
    fld.appendChild(label);
    fld.appendChild(input);
    return fld;
  }

  function makeRowDelete(row) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-del";
    btn.setAttribute("data-setting", "");
    btn.textContent = "删除";
    btn.addEventListener("click", function () {
      row.remove();
      syncRowState("link");
      dirty();
    });
    return btn;
  }

  /** 上移 / 下移一行；DOM 顺序就是保存进 KV 的数组顺序。 */
  function moveRow(row, direction) {
    var sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (direction < 0) row.parentNode.insertBefore(row, sibling);
    else row.parentNode.insertBefore(sibling, row);
    syncRowState("link");
    dirty();
  }

  function makeMoveButton(row, direction) {
    var label = direction < 0 ? "上移" : "下移";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-move";
    btn.setAttribute("data-setting", "");
    btn.setAttribute("data-move", direction < 0 ? "up" : "down");
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.textContent = direction < 0 ? "↑" : "↓";
    btn.addEventListener("click", function () {
      moveRow(row, direction);
      // 移动后本行可能到达边界，把焦点交给同一行仍可用的小按钮
      var arrow = row.querySelector('[data-move="' + (direction < 0 ? "up" : "down") + '"]');
      var target =
        arrow && !arrow.disabled
          ? arrow
          : row.querySelector(".row-actions button:not([disabled])");
      if (target) target.focus();
    });
    return btn;
  }

  function syncRowActions(row) {
    var hasPrev = Boolean(row.previousElementSibling);
    var hasNext = Boolean(row.nextElementSibling);
    each(row.querySelectorAll("[data-move]"), function (btn) {
      var isUp = btn.getAttribute("data-move") === "up";
      btn.disabled = !state.ready || (isUp ? !hasPrev : !hasNext);
    });
  }

  function makeRowActions(row) {
    var wrap = document.createElement("div");
    wrap.className = "row-actions";
    wrap.appendChild(makeMoveButton(row, -1));
    wrap.appendChild(makeMoveButton(row, 1));
    wrap.appendChild(makeRowDelete(row));
    return wrap;
  }

  function clearDropMarks() {
    each(document.querySelectorAll(".row.is-drop-before, .row.is-drop-after"), function (row) {
      row.classList.remove("is-drop-before", "is-drop-after");
    });
  }

  function clearRowDrag() {
    clearDropMarks();
    if (dragState) dragState.row.classList.remove("is-dragging");
    dragState = null;
    document.body.classList.remove("is-row-dragging");
  }

  function moveRowTo(row, target, placeAfter) {
    if (!row || !target || row === target) return;
    if (row.parentNode !== target.parentNode) return;
    if (placeAfter) {
      if (row.previousElementSibling === target) return;
      row.parentNode.insertBefore(row, target.nextSibling);
    } else {
      if (row.nextElementSibling === target) return;
      row.parentNode.insertBefore(row, target);
    }
    syncRowState("link");
    dirty();
  }

  function findRowAt(list, x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !list.contains(el)) return null;
    var row = el.closest(".row");
    return row && row.parentNode === list ? row : null;
  }

  /** 行首的拖拽把手：按住往下拖，松手时按落点前后插入。 */
  function makeDragHandle(row) {
    var handle = document.createElement("span");
    handle.className = "row-grip";
    handle.setAttribute("aria-hidden", "true");
    handle.title = "拖拽排序";

    handle.addEventListener("mousedown", function (event) {
      if (!state.ready || event.button !== 0 || dragState || !row.parentNode) return;
      event.preventDefault();
      var list = row.parentNode;
      dragState = {
        row: row,
        list: list,
        target: null,
        placeAfter: false
      };
      row.classList.add("is-dragging");
      document.body.classList.add("is-row-dragging");

      function onMove(moveEvent) {
        if (!dragState) return;
        // 拖到视口上下边缘时滚一点页面，再按新位置找落点
        if (moveEvent.clientY < 96) window.scrollBy(0, -14);
        else if (moveEvent.clientY > window.innerHeight - 96) window.scrollBy(0, 14);
        var target = findRowAt(list, moveEvent.clientX, moveEvent.clientY);
        clearDropMarks();
        dragState.target = null;
        if (!target || target === row) return;
        var rect = target.getBoundingClientRect();
        var placeAfter = moveEvent.clientY >= rect.top + rect.height / 2;
        target.classList.add(placeAfter ? "is-drop-after" : "is-drop-before");
        dragState.target = target;
        dragState.placeAfter = placeAfter;
      }

      function onCancel() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        window.removeEventListener("blur", onCancel);
        clearRowDrag();
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        window.removeEventListener("blur", onCancel);
        var current = dragState;
        if (!current) return;
        var target = current.target;
        var placeAfter = current.placeAfter;
        clearRowDrag();
        if (target) moveRowTo(current.row, target, placeAfter);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      // 鼠标在窗口外松开 / 窗口失焦时取消本次拖拽，避免行一直停在半透明状态
      window.addEventListener("blur", onCancel);
    });

    return handle;
  }

  function buildLinkRow(link, index) {
    var row = document.createElement("div");
    row.className = "row row--link";
    row.appendChild(makeDragHandle(row));
    row.appendChild(makeRowField("联系方式 " + (index + 1) + " 标签", "label", link.label, 24));
    var iconFld = makeRowField(
      "联系方式 " + (index + 1) + " 图标（Iconify 名称，留空自动识别）",
      "icon",
      link.icon,
      80
    );
    var iconInput = iconFld.querySelector("input");
    row.appendChild(iconFld);
    row.appendChild(makeRowField("联系方式 " + (index + 1) + " 链接", "href", link.href, 300));
    row.appendChild(makeRowActions(row));

    // 链接 / 图标改对后即刻消掉行内报错
    var hrefInput = row.querySelector('[data-key="href"]');
    hrefInput.addEventListener("input", function () {
      row.classList.remove("is-invalid");
      homeLinksErr.hidden = true;
    });
    iconInput.addEventListener("input", function () {
      row.classList.remove("is-invalid");
      homeLinksErr.hidden = true;
    });
    return row;
  }

  /** 兼容改版前的数据：图标名曾被填在 iconHtml 字段里；非 Iconify 名称一律丢弃。 */
  function normalizeLink(link) {
    var rawIcon = typeof link.icon === "string" ? link.icon : "";
    if (!ICON_RE.test(rawIcon.trim()) && typeof link.iconHtml === "string") {
      rawIcon = link.iconHtml;
    }
    var icon = ICON_RE.test(rawIcon.trim()) ? rawIcon.trim().toLowerCase() : "";
    return {
      label: typeof link.label === "string" ? link.label : "",
      href: typeof link.href === "string" ? link.href : "",
      icon: icon
    };
  }

  function renderLinks(raw) {
    var links = parseJsonArray(raw);
    if (!links.length && raw === undefined) links = DEFAULT_LINKS;
    links = links.slice(0, HOME_LINKS_MAX).map(normalizeLink);
    while (homeLinksRows.firstChild) homeLinksRows.removeChild(homeLinksRows.firstChild);
    each(links, function (link, index) {
      homeLinksRows.appendChild(buildLinkRow(link, index));
    });
    syncRowState("link");
  }

  function readLinks() {
    var out = [];
    each(homeLinksRows.querySelectorAll(".row"), function (row) {
      var item = {
        label: row.querySelector('[data-key="label"]').value.trim(),
        href: row.querySelector('[data-key="href"]').value.trim()
      };
      var icon = row.querySelector('[data-key="icon"]').value.trim().toLowerCase();
      if (icon) item.icon = icon;
      if (!item.label && !item.href) return;
      out.push(item);
    });
    return out;
  }

  function syncRowState(kind) {
    if (kind !== "link" || !homeLinksRows) return;
    var rows = homeLinksRows.querySelectorAll(".row");
    homeLinksCount.textContent = rows.length + " / " + HOME_LINKS_MAX;
    homeLinksEmpty.hidden = !state.ready || rows.length > 0;
    homeLinksAdd.disabled = !state.ready || rows.length >= HOME_LINKS_MAX;
    each(rows, syncRowActions);
  }

  function addLinkRow() {
    var count = homeLinksRows.querySelectorAll(".row").length;
    if (count >= HOME_LINKS_MAX) {
      toast("联系方式最多 " + HOME_LINKS_MAX + " 条");
      return;
    }
    homeLinksRows.appendChild(buildLinkRow(normalizeLink({}), count));
    syncRowState("link");
    dirty();
    var input = homeLinksRows.querySelector(".row:last-child input");
    if (input) input.focus();
  }

  /* ---------------- 表单收集 / 回填 ---------------- */
  function readForm() {
    // 图片路径在保存前再规范一次，保证输入框显示的值与写进 KV 的值一致
    each(IMAGE_PATH_IDS, function (inputId) {
      var input = $(inputId);
      if (!input) return;
      var next = normalizeImagePath(input.value);
      if (next !== input.value) input.value = next;
    });
    var data = {};
    Object.keys(FIELD_IDS).forEach(function (key) {
      data[key] = $(FIELD_IDS[key]).value.trim();
    });
    var color = themeColorText.value.trim();
    data.theme_color = THEME_COLOR_RE.test(color) ? color.toUpperCase() : color;
    data.home_links = JSON.stringify(readLinks());
    return data;
  }

  function applySettings(settings) {
    if (!settings) return;
    Object.keys(FIELD_IDS).forEach(function (key) {
      var el = $(FIELD_IDS[key]);
      var value = settings[key];
      el.value = typeof value === "string" ? value : "";
    });
    applyColor(typeof settings.theme_color === "string" ? settings.theme_color : THEME_COLOR_DEFAULT);
    renderLinks(settings.home_links);
    clearFieldErrors();
    state.settings = settings;
  }

  function clearFieldErrors() {
    each(document.querySelectorAll(".fld.is-invalid"), function (fld) {
      fld.classList.remove("is-invalid");
    });
    each(document.querySelectorAll(".row.is-invalid"), function (row) {
      row.classList.remove("is-invalid");
    });
    themeColorErr.hidden = true;
    footerRssErr.hidden = true;
    homeCoverImageErr.hidden = true;
    homeFigureAErr.hidden = true;
    homeFigureBErr.hidden = true;
    homeLinksErr.hidden = true;
  }

  function markIssues(issues) {
    clearFieldErrors();
    each(issues || [], function (issue) {
      if (issue.path === "home_links") {
        homeLinksErr.textContent = issue.message;
        homeLinksErr.hidden = false;
        return;
      }
      var id = issue.path === "theme_color" ? "themeColorText" : FIELD_IDS[issue.path];
      var el = id ? $(id) : null;
      if (!el) return;
      var fld = el.closest(".fld");
      if (fld) fld.classList.add("is-invalid");
      if (issue.path === "theme_color") {
        themeColorErr.textContent = issue.message;
        themeColorErr.hidden = false;
      }
      if (issue.path === "footer_rss") {
        footerRssErr.textContent = issue.message;
        footerRssErr.hidden = false;
      }
      if (issue.path === "home_cover_image") {
        homeCoverImageErr.textContent = issue.message;
        homeCoverImageErr.hidden = false;
      }
      if (issue.path === "home_p2_figure_a") {
        homeFigureAErr.textContent = issue.message;
        homeFigureAErr.hidden = false;
      }
      if (issue.path === "home_p2_figure_b") {
        homeFigureBErr.textContent = issue.message;
        homeFigureBErr.hidden = false;
      }
    });
  }

  /* ---------------- 前端校验（与接口规则一致） ---------------- */
  function validateForm() {
    clearFieldErrors();
    var ok = true;
    var color = themeColorText.value.trim();
    if (!THEME_COLOR_RE.test(color)) {
      themeColorText.closest(".fld").classList.add("is-invalid");
      themeColorErr.textContent = "主题色需要是 #RRGGBB 形式的十六进制颜色";
      themeColorErr.hidden = false;
      ok = false;
    }
    var rss = footerRss.value.trim();
    if (!RSS_RE.test(rss)) {
      footerRss.closest(".fld").classList.add("is-invalid");
      footerRssErr.textContent = "RSS 地址需要以 / 开头或 http(s):// 开头";
      footerRssErr.hidden = false;
      ok = false;
    }

    var cover = homeCoverImage.value.trim();
    if (!COVER_RE.test(cover)) {
      homeCoverImage.closest(".fld").classList.add("is-invalid");
      homeCoverImageErr.textContent = "封面图需要是 / 开头的站内路径或 http(s):// 链接";
      homeCoverImageErr.hidden = false;
      ok = false;
    }

    // 第 2 页装饰图允许留空（沿用封面图），非空时规则与封面图一致
    var figureA = homeFigureA.value.trim();
    if (figureA && !COVER_RE.test(figureA)) {
      homeFigureA.closest(".fld").classList.add("is-invalid");
      homeFigureAErr.textContent = "装饰图 A 需要是 / 开头的站内路径或 http(s):// 链接";
      homeFigureAErr.hidden = false;
      ok = false;
    }
    var figureB = homeFigureB.value.trim();
    if (figureB && !COVER_RE.test(figureB)) {
      homeFigureB.closest(".fld").classList.add("is-invalid");
      homeFigureBErr.textContent = "装饰图 B 需要是 / 开头的站内路径或 http(s):// 链接";
      homeFigureBErr.hidden = false;
      ok = false;
    }

    // 联系方式：标签 / 链接必填、链接协议白名单、图标留空或 Iconify 名称
    each(homeLinksRows.querySelectorAll(".row"), function (row, index) {
      var label = row.querySelector('[data-key="label"]').value.trim();
      var href = row.querySelector('[data-key="href"]').value.trim();
      var icon = row.querySelector('[data-key="icon"]').value.trim();
      if (!label) {
        row.classList.add("is-invalid");
        homeLinksErr.textContent = "第 " + (index + 1) + " 条联系方式缺标签";
        homeLinksErr.hidden = false;
        ok = false;
      }
      if (!LINK_RE.test(href)) {
        row.classList.add("is-invalid");
        homeLinksErr.textContent = "第 " + (index + 1) + " 条链接需要以 /、http(s)://、mailto: 或 # 开头";
        homeLinksErr.hidden = false;
        ok = false;
      }
      if (icon && !ICON_RE.test(icon)) {
        row.classList.add("is-invalid");
        homeLinksErr.textContent = "第 " + (index + 1) + " 条图标需要是 Iconify 名称，例如 ri:rss-fill";
        homeLinksErr.hidden = false;
        ok = false;
      }
    });

    if (!ok) {
      var first = document.querySelector(".fld.is-invalid input, .fld.is-invalid textarea, .row.is-invalid input");
      if (first) first.focus();
    }
    return ok;
  }

  /* ---------------- 接口请求 ---------------- */
  function request(method, body) {
    if (!API_URL) return Promise.reject(new Error("页面缺少设置接口地址"));
    var headers = { accept: "application/json", "x-admin-token": readStore(TOKEN_KEY) || "" };
    var init = { method: method, headers: headers, cache: "no-store" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(API_URL, init);
  }
  function readJson(res) {
    return res.json().catch(function () { return {}; });
  }

  /* ---------------- 加载设置 ---------------- */
  function loadSettings() {
    var token = (readStore(TOKEN_KEY) || "").trim();
    state.ready = false;
    state.settings = null;
    setEditable(false);
    hideBanner();

    if (!token) {
      setStatus("未连接 · 需要管理令牌", true);
      showBanner("info", "尚未连接后台", "点右上角「管理令牌」填入令牌后保存，页面会自动刷新并读取站点设置。");
      showTokenButton(true);
      return;
    }

    setStatus("正在读取设置…", false);
    request("GET").then(function (res) {
      if (res.status === 401) {
        setStatus("未授权 · 令牌无效", true);
        showBanner("error", "管理令牌无效", "令牌被拒绝，请在右上角「管理令牌」里更新后重试。");
        showTokenButton(true);
        return;
      }
      if (res.status === 503) {
        setStatus("只读 · 服务端未配置管理令牌", true);
        showBanner("warn", "服务端未配置管理令牌，当前只读", "联系站点管理员配置后重新加载页面。");
        return;
      }
      if (!res.ok) {
        setStatus("读取失败 · HTTP " + res.status, true);
        showBanner("error", "读取设置失败（HTTP " + res.status + "）", "稍后重试；问题持续时查看 Worker 日志。");
        return;
      }
      return readJson(res).then(function (data) {
        if (!data || !data.settings) throw new Error("接口响应缺少 settings 字段");
        applySettings(data.settings);
        state.ready = true;
        setEditable(true);
        setStatus("已读取 · " + timeNow(), false);
        hideBanner();
      });
    }).catch(function (err) {
      setStatus("连接失败 · 请检查服务", true);
      showBanner("error", "无法读取设置", err && err.message ? err.message : "网络或服务端异常，请稍后重试。");
    });
  }

  /* ---------------- 保存设置 ---------------- */
  function saveSettings() {
    if (!state.ready || state.saving) return;
    if (!validateForm()) {
      toast("有字段格式不对 · 未保存");
      return;
    }

    var data = readForm();
    var base = state.settings || {};
    // 只提交改动过的键，没动过的字段不进补丁（KV 里旧值保持）
    var patch = {};
    Object.keys(data).forEach(function (key) {
      var prev = base[key] === undefined ? "" : String(base[key]);
      if (data[key] !== prev) patch[key] = data[key];
    });
    if (Object.keys(patch).length === 0) {
      toast("没有需要保存的修改");
      setStatus("已读取 · 没有修改", false);
      return;
    }

    state.saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";

    request("PUT", patch).then(function (res) {
      return readJson(res).then(function (body) {
        return { status: res.status, ok: res.ok, body: body };
      });
    }).then(function (result) {
      if (result.status === 401) {
        state.ready = false;
        setEditable(false);
        setStatus("未授权 · 令牌无效", true);
        showBanner("error", "保存失败 · 管理令牌无效", "请在右上角「管理令牌」里更新令牌后重试。");
        showTokenButton(true);
        toast("保存失败 · 令牌无效");
        return;
      }
      if (result.status === 503) {
        state.ready = false;
        setEditable(false);
        setStatus("只读 · 服务端未配置管理令牌", true);
        showBanner("warn", "服务端未配置管理令牌，当前只读", "联系站点管理员配置后重新加载页面。");
        toast("保存失败 · 服务端未配置管理令牌");
        return;
      }
      if (result.status === 400) {
        var issues = result.body && result.body.issues ? result.body.issues : [];
        showBanner("error", "保存失败 · 字段校验未通过", "修正下列字段后重新保存：", issues);
        markIssues(issues);
        toast("保存失败 · " + (issues[0] ? issues[0].path + " 校验未通过" : "字段校验未通过"));
        return;
      }
      if (!result.ok) {
        setStatus("保存失败 · HTTP " + result.status, true);
        showBanner("error", "保存失败（HTTP " + result.status + "）", "服务端返回异常，稍后重试；问题持续时查看 Worker 日志。");
        toast("保存失败 · HTTP " + result.status);
        return;
      }
      if (!result.body || !result.body.settings) throw new Error("接口响应缺少 settings 字段");
      applySettings(result.body.settings);
      setStatus("最后保存 " + timeNow(), false);
      hideBanner();
      var homeChanged = Object.keys(patch).some(function (key) {
        return key.indexOf("home_cover") === 0 || key.indexOf("home_p2_") === 0;
      });
      var endChanged = Object.keys(patch).some(function (key) {
        return key.indexOf("home_afterword_") === 0;
      });
      toast(
        endChanged
          ? "设置已保存 · 首页尾页已更新"
          : homeChanged
            ? "设置已保存 · 首页图片已更新"
            : "设置已保存"
      );
    }).catch(function (err) {
      setStatus("保存失败 · 请重试", true);
      showBanner("error", "保存失败", err && err.message ? err.message : "网络或服务端异常，请稍后重试。");
      toast("保存失败 · 请重试");
    }).then(function () {
      state.saving = false;
      saveBtn.textContent = "保存设置";
      saveBtn.disabled = !state.ready;
    });
  }

  /* ---------------- 字段事件 ---------------- */
  themeColorPick.addEventListener("input", function () {
    applyColor(themeColorPick.value);
    dirty();
  });
  themeColorText.addEventListener("input", function () {
    syncColorFromText(false);
    dirty();
  });
  themeColorText.addEventListener("blur", function () {
    syncColorFromText(true);
  });
  Object.keys(FIELD_IDS).forEach(function (key) {
    var el = $(FIELD_IDS[key]);
    if (!el) return;
    el.addEventListener("input", function () {
      if (key === "home_cover_image" && COVER_RE.test(homeCoverImage.value.trim())) {
        homeCoverImage.closest(".fld").classList.remove("is-invalid");
        homeCoverImageErr.hidden = true;
      }
      // 第 2 页装饰图：改对或清空后即刻消掉行内报错
      if (key === "home_p2_figure_a" && (!homeFigureA.value.trim() || COVER_RE.test(homeFigureA.value.trim()))) {
        homeFigureA.closest(".fld").classList.remove("is-invalid");
        homeFigureAErr.hidden = true;
      }
      if (key === "home_p2_figure_b" && (!homeFigureB.value.trim() || COVER_RE.test(homeFigureB.value.trim()))) {
        homeFigureB.closest(".fld").classList.remove("is-invalid");
        homeFigureBErr.hidden = true;
      }
      dirty();
    });
  });
  homeLinksAdd.addEventListener("click", addLinkRow);
  saveBtn.addEventListener("click", saveSettings);

  /* ---------------- 初始化 ---------------- */
  bindImagePickers();
  applyColor(THEME_COLOR_DEFAULT);
  setEditable(false);
  loadSettings();
})();
