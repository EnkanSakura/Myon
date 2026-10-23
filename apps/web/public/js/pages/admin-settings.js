(function () {
  "use strict";

  /* ---------------- 常量与工具 ---------------- */
  var TOKEN_KEY = "myon-admin-token";
  var ABOUT_KEY = "myon-about";
  var THEME_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  var RSS_RE = /^(\/|https?:\/\/)/;
  var LINK_RE = /^(\/|https?:\/\/|mailto:|#)/;
  // 与 @myon/shared 的 iconifyNamePattern 保持一致（public/js 不参与打包）
  var ICON_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[-_][a-z0-9]+)*$/i;
  var COVER_RE = /^(\/|https?:\/\/)/;
  var HOME_STATS_MAX = 4;
  var HOME_LINKS_MAX = 6;
  var HOME_JSON_MAX = 3000;
  var THEME_LABEL = { light: "浅色", dark: "深色", system: "跟随系统" };

  // 设置接口字段 → 页面输入框 id
  var FIELD_IDS = {
    site_name: "siteName",
    site_subtitle: "siteSubtitle",
    site_description: "siteDescription",
    site_author: "siteAuthor",
    site_email: "siteEmail",
    footer_copyright: "footerCopyright",
    footer_tech: "footerTech",
    footer_icp: "footerIcp",
    footer_rss: "footerRss",
    footer_email: "footerEmail",
    home_title: "homeTitle",
    home_lead: "homeLead",
    home_cover_image: "homeCoverImage",
    home_cover_badge: "homeCoverBadge",
    home_cover_note: "homeCoverNote"
  };

  function $(id) { return document.getElementById(id); }
  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function removeStore(key) {
    try { localStorage.removeItem(key); } catch (e) {}
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

  // 首页预设与默认七页标签由服务端注入（来自 @myon/shared）。
  var HOME_CONFIG = {};
  if (pageEl) {
    try {
      HOME_CONFIG = JSON.parse(pageEl.getAttribute("data-home-config") || "{}");
    } catch (e) {
      HOME_CONFIG = {};
    }
  }
  var HOME_PRESETS = Array.isArray(HOME_CONFIG.presets) ? HOME_CONFIG.presets : [];
  var HOME_PRESET_MAP = {};
  each(HOME_PRESETS, function (preset) { HOME_PRESET_MAP[preset.key] = preset; });
  var DEFAULT_PAGE_LABELS = Array.isArray(HOME_CONFIG.pageLabels) ? HOME_CONFIG.pageLabels : [];

  var saveBtn = $("saveBtn");
  var saveState = $("saveState");
  var toastEl = $("toast");

  var banner = $("setBanner");
  var bannerK = $("setBannerK");
  var bannerTitle = $("setBannerTitle");
  var bannerText = $("setBannerText");
  var issuesEl = $("setIssues");
  var NOTICE_TONES = ["notice--info", "notice--warn", "notice--ok", "notice--error"];

  var tokenInput = $("adminToken");
  var tokenState = $("tokenState");
  var tokenSave = $("tokenSave");
  var tokenClear = $("tokenClear");

  var themeButtons = Array.prototype.slice.call(document.querySelectorAll("#themeSeg button"));
  var themeState = $("themeState");
  var themeColorPick = $("themeColorPick");
  var themeColorText = $("themeColorText");
  var themeColorPreview = $("themeColorPreview");
  var themeColorErr = $("themeColorErr");

  var swComments = $("swComments");
  var commentsState = $("commentsState");
  var basicState = $("basicState");
  var footerState = $("footerState");

  var footerRss = $("footerRss");
  var footerRssErr = $("footerRssErr");
  var footerEmail = $("footerEmail");
  var feedPreview = $("feedPreview");
  var feedEmailPreview = $("feedEmailPreview");

  var homeState = $("homeState");
  var homePageLabels = $("homePageLabels");
  var homePageLabelsErr = $("homePageLabelsErr");
  var homeStatsRows = $("homeStatsRows");
  var homeStatsEmpty = $("homeStatsEmpty");
  var homeStatsAdd = $("homeStatsAdd");
  var homeStatsCount = $("homeStatsCount");
  var homeStatsErr = $("homeStatsErr");
  var homeLinksRows = $("homeLinksRows");
  var homeLinksEmpty = $("homeLinksEmpty");
  var homeLinksAdd = $("homeLinksAdd");
  var homeLinksCount = $("homeLinksCount");
  var homeLinksErr = $("homeLinksErr");
  var homeCoverImage = $("homeCoverImage");
  var homeCoverImageErr = $("homeCoverImageErr");

  var cfmDlg = $("cfmDlg");
  var cfmTitle = $("cfmTitle");
  var cfmText = $("cfmText");
  var cfmOk = $("cfmOk");
  var cfmCancel = $("cfmCancel");

  var deployState = $("deployState");
  var latestDeploy = $("latestDeploy");
  var latestDeployAgo = $("latestDeployAgo");

  /* ---------------- 页面状态 ---------------- */
  var state = {
    ready: false,
    saving: false,
    settings: null,
    theme: "system",
    comments: true
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

  /* ---------------- 顶部状态条 ---------------- */
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
  }
  function hideBanner() {
    banner.hidden = true;
    issuesEl.hidden = true;
  }

  /* ---------------- 保存状态 / 可编辑状态 ---------------- */
  function setStatus(text, isDirty) {
    saveState.textContent = text;
    saveState.classList.toggle("is-dirty", !!isDirty);
  }
  function dirty() {
    if (!state.ready) return;
    setStatus("有未保存的修改", true);
    basicState.textContent = "有修改";
    homeState.textContent = "有修改";
    footerState.textContent = "有修改";
  }
  function setEditable(on) {
    each(document.querySelectorAll("[data-setting]"), function (el) {
      el.disabled = !on;
    });
    saveBtn.disabled = !on || state.saving;
    syncRowState("stat");
    syncRowState("link");
  }

  /* ---------------- 外观：默认主题 ---------------- */
  function applyTheme(value) {
    state.theme = THEME_LABEL[value] ? value : "system";
    each(themeButtons, function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme") === state.theme));
    });
    themeState.textContent = THEME_LABEL[state.theme];
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

  /* ---------------- 评论开关 ---------------- */
  function applyComments(on) {
    state.comments = !!on;
    swComments.setAttribute("aria-checked", String(state.comments));
    swComments.setAttribute("data-on", String(state.comments));
    commentsState.textContent = state.comments ? "已开启" : "已关闭";
  }

  /* ---------------- 订阅预览 ---------------- */
  function syncFeedPreview() {
    feedPreview.textContent = footerRss.value.trim() || "—";
    feedEmailPreview.textContent = footerEmail.value.trim() || "—";
  }

  /* ---------------- 首页：数据块 / 联系方式行编辑器 ---------------- */
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
    label.htmlFor = "homeRow" + (++rowSeq);
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

  function makeRowDelete(kind, row) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-del";
    btn.setAttribute("data-setting", "");
    btn.textContent = "删除";
    btn.addEventListener("click", function () {
      row.remove();
      syncRowState(kind);
      dirty();
    });
    return btn;
  }

  /** 上移 / 下移一行；DOM 顺序就是保存进 KV 的数组顺序。 */
  function moveRow(kind, row, direction) {
    var sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (direction < 0) row.parentNode.insertBefore(row, sibling);
    else row.parentNode.insertBefore(sibling, row);
    syncRowState(kind);
    dirty();
  }

  function makeMoveButton(kind, row, direction) {
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
      moveRow(kind, row, direction);
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

  function makeRowActions(kind, row) {
    var wrap = document.createElement("div");
    wrap.className = "row-actions";
    wrap.appendChild(makeMoveButton(kind, row, -1));
    wrap.appendChild(makeMoveButton(kind, row, 1));
    wrap.appendChild(makeRowDelete(kind, row));
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

  function moveRowTo(kind, row, target, placeAfter) {
    if (!row || !target || row === target) return;
    if (row.parentNode !== target.parentNode) return;
    if (placeAfter) {
      if (row.previousElementSibling === target) return;
      row.parentNode.insertBefore(row, target.nextSibling);
    } else {
      if (row.nextElementSibling === target) return;
      row.parentNode.insertBefore(row, target);
    }
    syncRowState(kind);
    dirty();
  }

  function findRowAt(list, x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !list.contains(el)) return null;
    var row = el.closest(".row");
    return row && row.parentNode === list ? row : null;
  }

  /** 行首的拖拽把手：按住往下拖，松手时按落点前后插入。 */
  function makeDragHandle(kind, row) {
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
        kind: kind,
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
        var state = dragState;
        if (!state) return;
        var target = state.target;
        var placeAfter = state.placeAfter;
        clearRowDrag();
        if (target) moveRowTo(state.kind, state.row, target, placeAfter);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      // 鼠标在窗口外松开 / 窗口失焦时取消本次拖拽，避免行一直停在半透明状态
      window.addEventListener("blur", onCancel);
    });

    return handle;
  }

  function presetInfo(key) {
    return HOME_PRESET_MAP[key] || HOME_PRESETS[0] || { key: key, label: key, unit: "" };
  }

  function presetLabelText(preset) {
    return preset.label + (preset.unit ? " · " + preset.unit : "");
  }

  function updateStatHint(row) {
    var hint = row.querySelector(".row-hint");
    if (!hint) return;
    var preset = presetInfo(row.querySelector('[data-key="preset"]').value);
    var custom = row.querySelector('[data-key="label"]').value.trim();
    var text = "默认「" + preset.label + "」";
    if (preset.unit) text += " · 单位「" + preset.unit + "」";
    text += " · 数值由站点统计实时计算";
    hint.textContent = custom ? "自定义标签「" + custom + "」 · " + text : text;
  }

  function buildStatRow(stat, index) {
    var row = document.createElement("div");
    row.className = "row row--stat";
    row.appendChild(makeDragHandle("stat", row));

    // 预设下拉：只选含义，数值由站点统计实时算
    var presetFld = document.createElement("div");
    presetFld.className = "fld";
    var presetLabel = document.createElement("label");
    presetLabel.className = "sr-only";
    presetLabel.htmlFor = "homeStatPreset" + (++rowSeq);
    presetLabel.textContent = "数据块 " + (index + 1) + " 预设";
    var select = document.createElement("select");
    select.id = presetLabel.htmlFor;
    select.setAttribute("data-key", "preset");
    select.setAttribute("data-setting", "");
    each(HOME_PRESETS, function (preset) {
      var option = document.createElement("option");
      option.value = preset.key;
      option.textContent = presetLabelText(preset);
      select.appendChild(option);
    });
    if (HOME_PRESET_MAP[stat.preset]) select.value = stat.preset;
    presetFld.appendChild(presetLabel);
    presetFld.appendChild(select);

    // 标签覆盖：留空则用预设默认标签
    var labelFld = makeRowField(
      "数据块 " + (index + 1) + " 标签覆盖（可选）",
      "label",
      stat.label,
      24
    );
    var labelInput = labelFld.querySelector("input");
    labelInput.placeholder = presetInfo(stat.preset).label;

    var check = document.createElement("label");
    check.className = "row-check";
    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("data-key", "accent");
    checkbox.setAttribute("data-setting", "");
    checkbox.checked = stat.accent;
    checkbox.addEventListener("change", dirty);
    check.appendChild(checkbox);
    check.appendChild(document.createTextNode("强调"));

    var hint = document.createElement("p");
    hint.className = "row-hint";

    row.appendChild(presetFld);
    row.appendChild(labelFld);
    row.appendChild(check);
    row.appendChild(makeRowActions("stat", row));
    row.appendChild(hint);

    select.addEventListener("change", function () {
      labelInput.placeholder = presetInfo(select.value).label;
      updateStatHint(row);
      dirty();
    });
    labelInput.addEventListener("input", function () {
      updateStatHint(row);
    });
    updateStatHint(row);
    return row;
  }

  function buildLinkRow(link, index) {
    var row = document.createElement("div");
    row.className = "row row--link";
    row.appendChild(makeDragHandle("link", row));
    row.appendChild(makeRowField("联系方式 " + (index + 1) + " 标签", "label", link.label, 24));
    var iconFld = makeRowField(
      "联系方式 " + (index + 1) + " 图标（Iconify 名称，留空自动识别）",
      "icon",
      link.icon,
      80
    );
    var iconInput = iconFld.querySelector("input");
    iconInput.placeholder = "ri:rss-fill";
    row.appendChild(iconFld);
    row.appendChild(makeRowField("联系方式 " + (index + 1) + " 链接", "href", link.href, 300));
    row.appendChild(makeRowActions("link", row));

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

  function normalizeStat(stat) {
    var preset = typeof stat.preset === "string" && HOME_PRESET_MAP[stat.preset] ? stat.preset : "";
    var label = typeof stat.label === "string" ? stat.label : "";

    if (!preset) {
      // 兼容旧格式（label/value/unit）：按标签反查预设
      var matched = "";
      each(HOME_PRESETS, function (item) {
        if (!matched && item.label === label) matched = item.key;
      });
      preset = matched || (HOME_PRESETS[0] ? HOME_PRESETS[0].key : "");
      if (matched) label = "";
    }
    if (label === presetInfo(preset).label) label = "";

    return { preset: preset, label: label, accent: stat.accent === true };
  }

  function normalizeLink(link) {
    // 兼容改版前的数据：图标名曾被填在 iconHtml 字段里；非 Iconify 名称一律丢弃
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

  function renderStats(raw) {
    var stats = parseJsonArray(raw).slice(0, HOME_STATS_MAX).map(normalizeStat);
    while (homeStatsRows.firstChild) homeStatsRows.removeChild(homeStatsRows.firstChild);
    each(stats, function (stat, index) {
      homeStatsRows.appendChild(buildStatRow(stat, index));
    });
    syncRowState("stat");
  }

  function renderLinks(raw) {
    var links = parseJsonArray(raw).slice(0, HOME_LINKS_MAX).map(normalizeLink);
    while (homeLinksRows.firstChild) homeLinksRows.removeChild(homeLinksRows.firstChild);
    each(links, function (link, index) {
      homeLinksRows.appendChild(buildLinkRow(link, index));
    });
    syncRowState("link");
  }

  function readPageLabels() {
    var out = [];
    each(homePageLabels.querySelectorAll(".page-label-input"), function (input) {
      out.push(input.value.trim());
    });
    return out;
  }

  function renderPageLabels(raw) {
    var labels = parseJsonArray(raw);
    each(homePageLabels.querySelectorAll(".page-label-input"), function (input, index) {
      var value = labels[index];
      input.value = typeof value === "string" ? value : (DEFAULT_PAGE_LABELS[index] || "");
    });
  }

  function readStats() {
    var out = [];
    each(homeStatsRows.querySelectorAll(".row"), function (row) {
      var item = { preset: row.querySelector('[data-key="preset"]').value };
      var label = row.querySelector('[data-key="label"]').value.trim();
      if (label) item.label = label;
      item.accent = row.querySelector('[data-key="accent"]').checked;
      out.push(item);
    });
    return out;
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
    var isStats = kind === "stat";
    var rows = (isStats ? homeStatsRows : homeLinksRows).querySelectorAll(".row");
    var max = isStats ? HOME_STATS_MAX : HOME_LINKS_MAX;
    (isStats ? homeStatsCount : homeLinksCount).textContent = rows.length + " / " + max;
    (isStats ? homeStatsEmpty : homeLinksEmpty).hidden = !state.ready || rows.length > 0;
    (isStats ? homeStatsAdd : homeLinksAdd).disabled = !state.ready || rows.length >= max;
    each(rows, syncRowActions);
  }

  function addStatRow() {
    var count = homeStatsRows.querySelectorAll(".row").length;
    if (count >= HOME_STATS_MAX) {
      toast("数据块最多 " + HOME_STATS_MAX + " 项");
      return;
    }
    homeStatsRows.appendChild(buildStatRow(normalizeStat({}), count));
    syncRowState("stat");
    dirty();
    var input = homeStatsRows.querySelector(".row:last-child input");
    if (input) input.focus();
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
    var data = {};
    Object.keys(FIELD_IDS).forEach(function (key) {
      data[key] = $(FIELD_IDS[key]).value.trim();
    });
    var color = themeColorText.value.trim();
    data.theme_color = THEME_COLOR_RE.test(color) ? color.toUpperCase() : color;
    data.default_theme = state.theme;
    data.comments_enabled = state.comments ? "true" : "false";
    data.home_page_labels = JSON.stringify(readPageLabels());
    data.home_stats = JSON.stringify(readStats());
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
    applyTheme(settings.default_theme);
    applyComments(settings.comments_enabled === "true");
    renderPageLabels(settings.home_page_labels);
    renderStats(settings.home_stats);
    renderLinks(settings.home_links);
    syncFeedPreview();
    basicState.textContent = "已同步";
    homeState.textContent = "已同步";
    footerState.textContent = "已同步";
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
    homePageLabelsErr.hidden = true;
    homeCoverImageErr.hidden = true;
    homeStatsErr.hidden = true;
    homeLinksErr.hidden = true;
  }

  function markIssues(issues) {
    clearFieldErrors();
    each(issues || [], function (issue) {
      if (issue.path === "home_page_labels") {
        homePageLabelsErr.textContent = issue.message;
        homePageLabelsErr.hidden = false;
        return;
      }
      if (issue.path === "home_stats") {
        homeStatsErr.textContent = issue.message;
        homeStatsErr.hidden = false;
        return;
      }
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

    each(homePageLabels.querySelectorAll(".page-label-input"), function (input, index) {
      if (!input.value.trim()) {
        input.closest(".fld").classList.add("is-invalid");
        homePageLabelsErr.textContent = "第 " + (index + 1) + " 页主标签不能为空";
        homePageLabelsErr.hidden = false;
        ok = false;
      }
    });

    each(homeStatsRows.querySelectorAll(".row"), function (row) {
      var preset = row.querySelector('[data-key="preset"]').value;
      if (!HOME_PRESET_MAP[preset]) {
        row.classList.add("is-invalid");
        homeStatsErr.textContent = "数据块里有无法识别的预设";
        homeStatsErr.hidden = false;
        ok = false;
      }
    });

    each(homeLinksRows.querySelectorAll(".row"), function (row, index) {
      var href = row.querySelector('[data-key="href"]').value.trim();
      if (!LINK_RE.test(href)) {
        row.classList.add("is-invalid");
        homeLinksErr.textContent = "第 " + (index + 1) + " 条链接需要以 /、http(s)://、mailto: 或 # 开头";
        homeLinksErr.hidden = false;
        ok = false;
      }
      var icon = row.querySelector('[data-key="icon"]').value.trim();
      if (icon && !ICON_RE.test(icon)) {
        row.classList.add("is-invalid");
        homeLinksErr.textContent = "第 " + (index + 1) + " 条图标需要是 Iconify 名称，例如 ri:rss-fill";
        homeLinksErr.hidden = false;
        ok = false;
      }
    });

    var statsJson = JSON.stringify(readStats());
    var linksJson = JSON.stringify(readLinks());
    var labelsJson = JSON.stringify(readPageLabels());
    if (labelsJson.length > HOME_JSON_MAX) {
      homePageLabelsErr.textContent = "七页主标签内容太长，最多 " + HOME_JSON_MAX + " 个字符";
      homePageLabelsErr.hidden = false;
      ok = false;
    }
    if (statsJson.length > HOME_JSON_MAX) {
      homeStatsErr.textContent = "数据块内容太长，最多 " + HOME_JSON_MAX + " 个字符";
      homeStatsErr.hidden = false;
      ok = false;
    }
    if (linksJson.length > HOME_JSON_MAX) {
      homeLinksErr.textContent = "联系方式内容太长，最多 " + HOME_JSON_MAX + " 个字符";
      homeLinksErr.hidden = false;
      ok = false;
    }

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
      tokenState.textContent = "未填写";
      setStatus("未连接 · 需要管理令牌", true);
      showBanner("info", "尚未填写管理令牌", "在页面底部「系统 · 管理令牌」填入 ADMIN_TOKEN 后保存，页面会重新拉取站点设置。");
      return;
    }

    tokenState.textContent = "校验中…";
    setStatus("正在读取设置…", false);
    request("GET").then(function (res) {
      if (res.status === 401) {
        tokenState.textContent = "令牌无效";
        setStatus("未授权 · 令牌无效", true);
        showBanner("error", "管理令牌无效（401）", "检查令牌是否与 ADMIN_TOKEN 一致，改好后到页面底部「系统 · 管理令牌」重新保存。");
        return;
      }
      if (res.status === 503) {
        tokenState.textContent = "只读";
        setStatus("只读 · 服务端未配置 ADMIN_TOKEN", true);
        showBanner("warn", "服务端未配置 ADMIN_TOKEN，当前只读", "在 Workers 的环境变量或本地 .dev.vars 里配置 ADMIN_TOKEN 后重新加载页面。");
        return;
      }
      if (!res.ok) {
        tokenState.textContent = "读取失败";
        setStatus("读取失败 · HTTP " + res.status, true);
        showBanner("error", "读取设置失败（HTTP " + res.status + "）", "稍后重试；问题持续时查看 Worker 日志。");
        return;
      }
      return readJson(res).then(function (data) {
        if (!data || !data.settings) throw new Error("接口响应缺少 settings 字段");
        applySettings(data.settings);
        state.ready = true;
        setEditable(true);
        tokenState.textContent = "已连接";
        setStatus("已连接 · " + timeNow() + " 读取", false);
        hideBanner();
      });
    }).catch(function (err) {
      tokenState.textContent = "连接失败";
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
    var patch = {};
    Object.keys(data).forEach(function (key) {
      var prev = base[key] === undefined ? "" : String(base[key]);
      if (data[key] !== prev) patch[key] = data[key];
    });
    if (Object.keys(patch).length === 0) {
      toast("没有需要保存的修改");
      setStatus("已连接 · 没有修改", false);
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
        tokenState.textContent = "令牌无效";
        setStatus("未授权 · 令牌无效", true);
        showBanner("error", "保存失败 · 管理令牌无效（401）", "令牌被拒绝，请检查页面底部「系统 · 管理令牌」后重新保存。");
        toast("保存失败 · 令牌无效");
        return;
      }
      if (result.status === 503) {
        state.ready = false;
        setEditable(false);
        tokenState.textContent = "只读";
        setStatus("只读 · 服务端未配置 ADMIN_TOKEN", true);
        showBanner("warn", "服务端未配置 ADMIN_TOKEN，当前只读", "在 Workers 的环境变量或本地 .dev.vars 里配置 ADMIN_TOKEN 后重新加载页面。");
        toast("保存失败 · 服务端未配置 ADMIN_TOKEN");
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
      setStatus("最后保存 " + timeNow() + " · 已写入 KV", false);
      hideBanner();
      var homeChanged = Object.keys(patch).some(function (key) {
        return key.indexOf("home_") === 0;
      });
      toast(homeChanged ? "设置已保存 · 首页第一页已更新" : "设置已保存 · 已写入 KV");
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

  /* ---------------- 管理令牌 ---------------- */
  function saveToken() {
    var token = tokenInput.value.trim();
    if (!token) {
      toast("令牌不能为空");
      tokenInput.focus();
      return;
    }
    if (!writeStore(TOKEN_KEY, token)) {
      toast("无法写入本机存储 · 请用本地服务器打开");
      return;
    }
    tokenInput.value = token;
    toast("令牌已保存 · 正在重新拉取");
    loadSettings();
  }
  function clearToken() {
    removeStore(TOKEN_KEY);
    tokenInput.value = "";
    state.ready = false;
    state.settings = null;
    setEditable(false);
    tokenState.textContent = "未填写";
    setStatus("未连接 · 需要管理令牌", true);
    showBanner("info", "尚未填写管理令牌", "在页面底部「系统 · 管理令牌」填入 ADMIN_TOKEN 后保存，页面会重新拉取站点设置。");
    toast("已清除本机令牌");
  }

  /* ---------------- 主题 / 字段事件 ---------------- */
  each(themeButtons, function (b) {
    b.addEventListener("click", function () {
      applyTheme(b.getAttribute("data-theme"));
      dirty();
    });
  });
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
  swComments.addEventListener("click", function () {
    applyComments(!state.comments);
    dirty();
  });
  Object.keys(FIELD_IDS).forEach(function (key) {
    var el = $(FIELD_IDS[key]);
    if (!el) return;
    el.addEventListener("input", function () {
      if (key === "footer_rss" || key === "footer_email") syncFeedPreview();
      if (key === "home_cover_image" && COVER_RE.test(homeCoverImage.value.trim())) {
        homeCoverImage.closest(".fld").classList.remove("is-invalid");
        homeCoverImageErr.hidden = true;
      }
      dirty();
    });
  });
  each(homePageLabels.querySelectorAll(".page-label-input"), function (input) {
    input.addEventListener("input", function () {
      input.closest(".fld").classList.remove("is-invalid");
      homePageLabelsErr.hidden = true;
      dirty();
    });
  });
  homeStatsAdd.addEventListener("click", addStatRow);
  homeLinksAdd.addEventListener("click", addLinkRow);
  tokenSave.addEventListener("click", saveToken);
  tokenClear.addEventListener("click", clearToken);
  tokenInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveToken();
    }
  });
  saveBtn.addEventListener("click", saveSettings);

  /* ---------------- 危险操作确认 ---------------- */
  var pending = null;

  function ask(title, desc, fn) {
    cfmTitle.textContent = title;
    cfmText.textContent = desc;
    pending = fn;
    if (typeof cfmDlg.showModal === "function") cfmDlg.showModal();
  }
  cfmCancel.addEventListener("click", function () { cfmDlg.close(); });
  cfmDlg.addEventListener("click", function (e) {
    if (e.target === cfmDlg) cfmDlg.close();
  });
  cfmOk.addEventListener("click", function () {
    var fn = pending;
    pending = null;
    cfmDlg.close();
    if (fn) fn();
  });

  function actionPurge() {
    toast("已清除缓存 · 前端模拟，未连后端");
  }
  function actionExport() {
    var payload = {
      exportedAt: new Date().toISOString(),
      settings: readForm(),
      about: readStore(ABOUT_KEY) || ""
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "myon-export.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("已导出 myon-export.json");
  }
  function actionRebuild() {
    // 构建由 GitHub Actions 运行，后台没有触发部署的权限；这里只给出提示，不伪造部署结果。
    toast("构建由 GitHub Actions 运行 · 请到 Actions 手动触发");
  }

  $("btnPurge").addEventListener("click", function () {
    ask("清除缓存", this.getAttribute("data-desc"), actionPurge);
  });
  $("btnExport").addEventListener("click", function () {
    ask("导出数据", this.getAttribute("data-desc"), actionExport);
  });
  $("btnRebuild").addEventListener("click", function () {
    ask("重建站点", this.getAttribute("data-desc"), actionRebuild);
  });

  /* ---------------- 初始化 ---------------- */
  tokenInput.value = readStore(TOKEN_KEY) || "";
  applyColor(THEME_COLOR_DEFAULT);
  syncFeedPreview();
  setEditable(false);
  loadSettings();
})();
