(function () {
  "use strict";

  /* ================= 常量 ================= */
  var TOKEN_KEY = "myon-admin-token";
  var PAGE_LIMIT = 20;
  var MAX_BODY = 2000;

  /* ================= 工具 ================= */
  function $(id) { return document.getElementById(id); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = String(value);
  }
  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function hasToken() { return !!(readStore(TOKEN_KEY) || "").trim(); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 图片预览地址：规则和 apps/web/src/lib/media.ts 一致，前缀由服务端渲染给页面。
  function mediaSrc(key) {
    if (!key) return "";
    if (/^(https?:)?\/\//.test(key) || key.charAt(0) === "/") return key;
    return MEDIA_BASE.replace(/\/+$/, "") + "/" + key.replace(/^\/+/, "");
  }
  function fileName(key) {
    return key ? String(key).split("/").pop() : "";
  }
  // 和前台 formatDateTime 一致：2026.10.20 23:10。
  function fmtDateTime(value) {
    if (!value || value.length < 16) return "—";
    return value.slice(0, 10).replace(/-/g, ".") + " " + value.slice(11, 16);
  }
  function relTime(value) {
    var t = Date.parse(value);
    if (Number.isNaN(t)) return "—";
    var diff = Date.now() - t;
    if (diff < 60 * 1000) return "刚刚";
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + " 小时前";
    var d = new Date(t);
    return d.getFullYear() + "." + pad2(d.getMonth() + 1) + "." + pad2(d.getDate());
  }
  function isToday(value) {
    var t = Date.parse(value);
    if (Number.isNaN(t)) return false;
    var d = new Date(t);
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }
  function snippet(text, max) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    var limit = max || 36;
    return value.length > limit ? value.slice(0, limit) + "…" : value;
  }

  /* ================= 页面地址（服务端渲染） ================= */
  var pageEl = document.querySelector(".page[data-api-moments]");
  var MOMENTS_API = pageEl ? pageEl.getAttribute("data-api-moments") || "" : "";
  var MEDIA_API = pageEl ? pageEl.getAttribute("data-api-media") || "" : "";
  var GIF_API = pageEl ? pageEl.getAttribute("data-gif-api") || "" : "";
  var MEDIA_BASE = pageEl ? pageEl.getAttribute("data-media-base") || "" : "";
  // 分类候选只来自服务端渲染的真实分类；没有数据时组合框提示直接输入。
  var CATEGORY_OPTIONS = (function () {
    try {
      var raw = pageEl ? pageEl.getAttribute("data-cat-options") : "";
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  })();
  // 动态最多配几张图：由页面渲染 @myon/shared 的 momentMediaMaxCount。
  var MOMENT_MEDIA_MAX =
    Number(pageEl ? pageEl.getAttribute("data-media-max") : "") || 9;
  // 配图尺寸档位：由页面用 @myon/shared 的 mediaImageSizes 渲染成 JSON。
  var IMAGE_SIZES = (function () {
    var raw = pageEl ? pageEl.getAttribute("data-image-sizes") : "";
    var image = window.MyonImage;
    if (image && typeof image.parseSizes === "function") return image.parseSizes(raw);
    return ["480", "720", "1080", "1440", "orig"];
  })();
  // 老数据没有 mediaSize 时按默认 720 显示；与 @myon/shared 的 defaultMediaImageSize 一致。
  var DEFAULT_MEDIA_SIZE = "720";

  /** 站内图片低清预览地址；外链 / 空值由 MyonImage 原样返回。 */
  function previewSrc(src, width) {
    var image = window.MyonImage;
    return image && typeof image.preview === "function"
      ? image.preview(src, width)
      : src;
  }

  /** 内容图按尺寸档位取转换地址（orig 时带 size=orig）。 */
  function contentSrc(src, size) {
    var image = window.MyonImage;
    return image && typeof image.content === "function"
      ? image.content(src, size || DEFAULT_MEDIA_SIZE)
      : src;
  }

  /** 尺寸档位文案：「长边 720px」/「原图」。 */
  function sizeText(size) {
    var image = window.MyonImage;
    if (image && typeof image.describe === "function") return image.describe(size);
    return String(size) === "orig" ? "原图" : "长边 " + size + "px";
  }

  /** 接口数据 → 表单可编辑的配图数组；兼容只有 mediaKey 的老动态。 */
  function mediaOf(item) {
    var list = Array.isArray(item && item.media) ? item.media : [];
    var entries = list
      .filter(function (entry) { return entry && entry.key; })
      .map(function (entry) {
        return {
          key: entry.key,
          size: entry.size || DEFAULT_MEDIA_SIZE,
          name: entry.filename || fileName(entry.key)
        };
      });
    if (!entries.length && item && item.mediaKey) {
      entries = [{
        key: item.mediaKey,
        size: item.mediaSize || DEFAULT_MEDIA_SIZE,
        name: fileName(item.mediaKey)
      }];
    }
    return entries.slice(0, MOMENT_MEDIA_MAX);
  }

  /* ================= 元素 ================= */
  var btnCompose = $("btnCompose");

  // 列表
  var noteList = $("noteList");
  var noteSearch = $("noteSearch");
  var catSel = $("catSel");
  var shownNotes = $("shownNotes");
  var emptyNotes = $("emptyNotes");
  var emptyTitle = $("emptyTitle");
  var emptyText = $("emptyText");
  var btnResetFilter = $("btnResetFilter");
  var clearFilters = $("clearFilters");
  var imgToggle = $("imgToggle");
  var toastEl = $("toast");
  var pgNow = $("pgNow");
  var pgTotal = $("pgTotal");
  var pgPrev = $("pgPrev");
  var pgNext = $("pgNext");

  // 页面级提示
  var amBanner = $("amBanner");
  var amBannerK = $("amBannerK");
  var amBannerTitle = $("amBannerTitle");
  var amBannerText = $("amBannerText");
  var NOTICE_TONES = ["notice--info", "notice--warn", "notice--ok", "notice--error"];

  // 发 / 编辑动态弹窗
  var momentDlg = $("momentDlg");
  var momentForm = $("momentForm");
  var momentDlgTitle = $("momentDlgTitle");
  var momentDlgState = $("momentDlgState");
  var momentBanner = $("momentBanner");
  var momentBannerK = $("momentBannerK");
  var momentBannerTitle = $("momentBannerTitle");
  var momentBannerText = $("momentBannerText");
  var momentIssues = $("momentIssues");
  var noteText = $("noteText");
  var noteCount = $("noteCount");
  var noteCategory = $("noteCategory");
  var noteCategoryToggle = $("noteCategoryToggle");
  var categoryList = $("categoryList");
  var categoryCombo = null;
  var visPick = $("visPick");
  var pinPick = $("pinPick");
  var btnPublish = $("btnPublish");
  var btnCancelMoment = $("btnCancelMoment");
  var btnPickImage = $("btnPickImage");
  var attachList = $("attachList");
  var attachEmpty = $("attachEmpty");
  var btnClearImages = $("btnClearImages");

  // 删除确认
  var confirmDlg = $("confirmDlg");
  var confirmTitle = $("confirmTitle");
  var confirmMeta = $("confirmMeta");
  var confirmState = $("confirmState");
  var confirmOk = $("confirmOk");
  var confirmCancel = $("confirmCancel");

  /* ================= 状态 ================= */
  var state = {
    items: [],
    total: 0,
    offset: 0,
    limit: PAGE_LIMIT,
    countsKnown: false,
    filter: "all",
    imgOnly: false,
    q: "",
    editingId: null,
    media: [],
    visibility: "public",
    pinned: false,
    busy: false,
    loading: false,
    loadError: "",
    pendingDelete: null
  };

  /* ================= 提示 ================= */
  var toastTimer = null;
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 3200);
  }

  function setNoticeTone(tone) {
    each(NOTICE_TONES, function (name) { amBanner.classList.remove(name); });
    amBanner.classList.add("notice--" + tone);
  }
  function showBanner(tone, title, text) {
    if (!amBanner) return;
    amBanner.hidden = false;
    setNoticeTone(tone);
    amBannerK.textContent = tone === "error" ? "ERR" : tone === "warn" ? "WARN" : "INFO";
    amBannerTitle.textContent = title;
    amBannerText.textContent = text || "";
    amBannerText.hidden = !text;
  }
  function hideBanner() {
    if (amBanner) amBanner.hidden = true;
  }

  // 弹窗内的错误 / 提示条：页面级 notice 会被模态背景挡住，所以弹窗里单独一条。
  function hideFormBanner() {
    if (!momentBanner) return;
    momentBanner.hidden = true;
    if (momentIssues) momentIssues.hidden = true;
  }
  function showFormBanner(tone, title, text, issues) {
    if (!momentBanner) return;
    momentBanner.hidden = false;
    momentBanner.setAttribute("data-tone", tone === "warn" ? "warn" : "error");
    momentBannerK.textContent = tone === "warn" ? "WARN" : "ERR";
    momentBannerTitle.textContent = title;
    momentBannerText.textContent = text || "";
    momentBannerText.hidden = !text;
    if (!momentIssues) return;
    momentIssues.replaceChildren();
    var lines = issues || [];
    lines.forEach(function (line) {
      momentIssues.appendChild(el("li", null, line));
    });
    momentIssues.hidden = lines.length === 0;
  }

  /* ================= 接口 ================= */
  function api(method, url, body) {
    if (!url) return Promise.reject(new Error("页面缺少接口地址"));
    var headers = { accept: "application/json", "x-admin-token": (readStore(TOKEN_KEY) || "").trim() };
    var init = { method: method, headers: headers, cache: "no-store", credentials: "same-origin" };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(url, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, ok: res.ok, data: data };
      });
    });
  }

  function handleAuth(result) {
    if (!result) return false;
    if (result.status === 401) {
      showBanner("error", "管理令牌无效", "令牌被服务端拒绝。点右上角「管理令牌」更新后重试。");
      return true;
    }
    if (result.status === 503) {
      showBanner("warn", "服务端未配置管理令牌", "后台写接口暂时关闭，联系站点管理员配置后重新加载页面。");
      return true;
    }
    return false;
  }

  function issueLines(data) {
    var issues = data && data.issues ? data.issues : [];
    return issues.map(function (issue) {
      return (issue.path || "字段") + "：" + issue.message;
    });
  }

  /* ================= 渲染：列表 ================= */
  function actBtn(act, label) {
    var b = el("button", "nr-act" + (act === "del" ? " nr-act--del" : ""), label);
    b.type = "button";
    b.setAttribute("data-act", act);
    return b;
  }

  function buildRow(item) {
    var row = el("div", "note-r" + (item.pinned ? " is-pinned" : ""));
    var itemMedia = mediaOf(item);
    row.setAttribute("data-id", item.id);
    row.setAttribute("data-tag", item.category);
    row.setAttribute("data-img", itemMedia.length ? "1" : "0");
    row.setAttribute("data-pinned", item.pinned ? "1" : "0");
    row.setAttribute("data-vis", item.visibility);
    row.setAttribute("data-text", (item.body + " " + item.category).toLowerCase());

    var time = el("div", "nr-time");
    time.appendChild(el("span", "nr-when", fmtDateTime(item.createdAt)));
    if (item.pinned) time.appendChild(el("span", "pin-tag", "置顶"));
    var isPrivate = item.visibility === "private";
    time.appendChild(el("span", isPrivate ? "self-tag is-private" : "self-tag", isPrivate ? "仅自己" : "公开"));

    var body = el("div", "nr-body", item.body);

    var thumb = el("div", "nr-thumb");
    var firstMedia = itemMedia[0];
    var src = firstMedia ? mediaSrc(firstMedia.key) : "";
    if (src) {
      var img = document.createElement("img");
      // 列表缩略图走低清预览（长边 240px），不拉原图。
      img.src = previewSrc(src, 240);
      img.alt = "动态配图缩略";
      img.loading = "lazy";
      thumb.appendChild(img);
      if (itemMedia.length > 1) {
        thumb.appendChild(el("span", "nr-thumb-count", "+" + (itemMedia.length - 1)));
      }
    } else {
      thumb.classList.add("is-empty");
      thumb.appendChild(el("span", "nr-empty", "—"));
    }

    var catCell = el("div", "nr-tag");
    catCell.appendChild(el("span", "tag tag--dark", item.category));

    var acts = el("div", "nr-acts");
    acts.appendChild(actBtn("edit", "编辑"));
    var pinBtn = actBtn("pin", item.pinned ? "取消置顶" : "置顶");
    if (item.pinned) pinBtn.classList.add("is-on");
    acts.appendChild(pinBtn);
    acts.appendChild(actBtn("del", "删除"));

    row.appendChild(time);
    row.appendChild(body);
    row.appendChild(thumb);
    row.appendChild(catCell);
    row.appendChild(acts);
    return row;
  }

  function match(row) {
    if (state.imgOnly && row.getAttribute("data-img") !== "1") return false;
    if (state.filter !== "all" && row.getAttribute("data-tag") !== state.filter) return false;
    if (state.q) {
      var hay = row.getAttribute("data-text") || "";
      if (hay.indexOf(state.q) < 0) return false;
    }
    return true;
  }

  function updateEmpty(rowsCount, shownCount) {
    if (!emptyNotes) return;
    if (rowsCount === 0) {
      emptyNotes.hidden = false;
      btnResetFilter.hidden = true;
      if (state.loadError) {
        emptyTitle.textContent = "列表读不出来";
        emptyText.textContent = state.loadError;
      } else if (!hasToken() || !state.countsKnown) {
        emptyTitle.textContent = "还没有读到动态";
        emptyText.textContent = "填写管理令牌后，这里会显示真实数据。";
      } else {
        emptyTitle.textContent = "还没有动态";
        emptyText.textContent = "点右上角「发动态」写第一条。";
      }
      return;
    }
    if (shownCount === 0) {
      emptyNotes.hidden = false;
      emptyTitle.textContent = "没有符合条件的动态";
      emptyText.textContent = "换个分类，或者清空搜索词。";
      btnResetFilter.hidden = false;
      return;
    }
    emptyNotes.hidden = true;
    btnResetFilter.hidden = true;
  }

  function applyFilter() {
    var rows = [].slice.call(noteList.querySelectorAll(".note-r"));
    var shown = 0;
    rows.forEach(function (row) {
      var ok = match(row);
      row.hidden = !ok;
      if (ok) shown += 1;
    });
    setText("shownNotes", "显示 " + shown + " 条 · 筛选只作用于本页");
    updateEmpty(rows.length, shown);
  }

  function renderRows() {
    each(noteList.querySelectorAll(".note-r"), function (row) { row.remove(); });
    state.items.forEach(function (item) { noteList.appendChild(buildRow(item)); });
    applyFilter();
  }

  function renderStats() {
    var known = state.countsKnown;
    setText("stickerPub", known ? state.total : "—");
    if (!known) {
      setText("noteToday", "—");
      setText("noteLast", "—");
      return;
    }
    var today = 0;
    var latest = "";
    state.items.forEach(function (item) {
      if (isToday(item.createdAt)) today += 1;
      if (item.createdAt > latest) latest = item.createdAt;
    });
    if (state.offset === 0) setText("noteToday", today);
    setText("noteLast", latest ? relTime(latest) : "—");
    var rail = $("railNotes");
    if (rail) rail.textContent = String(state.total);
  }

  function renderPager() {
    var pageCount = Math.max(1, Math.ceil(state.total / state.limit));
    var page = Math.floor(state.offset / state.limit) + 1;
    setText("pgNow", state.countsKnown ? page : "—");
    setText("pgTotal", state.countsKnown ? pageCount : "—");
    pgPrev.disabled = !state.countsKnown || page <= 1 || state.loading;
    pgNext.disabled = !state.countsKnown || page >= pageCount || state.loading;
  }

  // 分类筛选是原生 select（combo.js 会自动增强成 MyonCombo 外观），
  // 页面只读写 select.value 并监听 change。
  function setFilter(value) {
    state.filter = value || "all";
    if (catSel && catSel.value !== state.filter) catSel.value = state.filter;
    applyFilter();
  }

  function paintImgToggle() {
    if (!imgToggle) return;
    imgToggle.setAttribute("aria-pressed", String(state.imgOnly));
    imgToggle.classList.toggle("is-on", state.imgOnly);
  }

  // 筛选下拉：把已加载数据里出现的新分类补进 option（去重，「全部分类」保持第一）。
  function ensureFilterOptions() {
    if (!catSel) return;
    var known = {};
    each(catSel.options, function (opt) { known[opt.value] = true; });
    state.items.forEach(function (item) {
      var name = item.category;
      if (!name || known[name]) return;
      known[name] = true;
      catSel.appendChild(new Option(name, name));
    });
    // 当前筛选值不在候选里时回退「全部分类」。
    if (state.filter !== "all" && !known[state.filter]) setFilter("all");
  }

  function resetFilters() {
    state.q = "";
    state.imgOnly = false;
    noteSearch.value = "";
    paintImgToggle();
    setFilter("all");
    noteSearch.focus();
  }

  function sortItems() {
    state.items.sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  function findItem(id) {
    for (var i = 0; i < state.items.length; i += 1) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  /* ================= 加载列表 ================= */
  function loadList(reset) {
    if (state.loading) return;
    if (reset) state.offset = 0;
    state.loadError = "";
    if (!hasToken()) {
      state.items = [];
      state.total = 0;
      state.countsKnown = false;
      renderRows();
      renderStats();
      renderPager();
      showBanner("info", "尚未连接后台", "动态列表和发布都需要管理令牌。点右上角「管理令牌」填入令牌后保存，页面会自动刷新。");
      return;
    }
    state.loading = true;
    renderPager();
    var url = MOMENTS_API + "?limit=" + state.limit + "&offset=" + state.offset;
    api("GET", url).then(function (res) {
      if (handleAuth(res)) {
        state.items = [];
        state.total = 0;
        state.countsKnown = false;
        renderRows();
        renderStats();
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = res.data || {};
      state.items = Array.isArray(data.items) ? data.items : [];
      state.total = Number(data.total) || 0;
      state.countsKnown = true;
      hideBanner();
      ensureFilterOptions();
      renderRows();
      renderStats();
    }).catch(function (err) {
      state.items = [];
      state.total = 0;
      state.countsKnown = false;
      state.loadError = "读取列表失败：" + ((err && err.message) || "网络或服务端异常");
      showBanner("error", "读取列表失败", (err && err.message) || "网络或服务端异常，请稍后重试。");
      renderRows();
      renderStats();
    }).then(function () {
      state.loading = false;
      renderPager();
    });
  }

  /* ================= 弹窗：打开 / 填充 / 关闭 ================= */
  function syncCounter() {
    if (noteText) setText("noteCount", noteText.value.length);
  }

  function paintVisibility() {
    each(visPick.querySelectorAll(".moment-tag"), function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-vis") === state.visibility));
    });
  }

  function paintPinned() {
    pinPick.setAttribute("aria-pressed", String(state.pinned));
    pinPick.textContent = state.pinned ? "已置顶 · 点击取消" : "置顶这条";
  }

  /** 配图列表：每张一行，可单独改尺寸 / 移除。 */
  function paintMedia() {
    if (!attachList) return;
    attachList.replaceChildren();
    state.media.forEach(function (entry, index) {
      var row = el("div", "moment-attach-row");
      row.setAttribute("data-key", entry.key);

      var img = document.createElement("img");
      img.alt = "第 " + (index + 1) + " 张配图";
      img.loading = "lazy";
      img.src = contentSrc(mediaSrc(entry.key), entry.size || DEFAULT_MEDIA_SIZE);
      row.appendChild(img);

      var meta = el("div", "moment-attach-meta");
      meta.appendChild(el("span", "moment-attach-index", "FIG." + pad2(index + 1)));
      var name = el("span", "moment-attach-name", entry.name || fileName(entry.key));
      name.title = entry.key;
      meta.appendChild(name);
      row.appendChild(meta);

      var select = document.createElement("select");
      select.className = "moment-size-select";
      select.setAttribute("aria-label", "第 " + (index + 1) + " 张配图的长边像素");
      IMAGE_SIZES.forEach(function (size) {
        var option = document.createElement("option");
        option.value = size;
        option.textContent = sizeText(size);
        if (size === (entry.size || DEFAULT_MEDIA_SIZE)) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener("change", function () {
        entry.size = select.value;
        img.src = contentSrc(mediaSrc(entry.key), entry.size);
      });
      row.appendChild(select);

      var remove = el("button", "moment-act moment-attach-remove", "移除");
      remove.type = "button";
      remove.addEventListener("click", function () {
        state.media.splice(index, 1);
        paintMedia();
      });
      row.appendChild(remove);
      attachList.appendChild(row);
    });
    if (attachEmpty) attachEmpty.hidden = state.media.length > 0;
    if (btnClearImages) btnClearImages.hidden = state.media.length === 0;
  }

  function paintPublishLabel() {
    btnPublish.disabled = state.busy;
    btnPublish.innerHTML = state.editingId
      ? '保存修改 <span class="ar" aria-hidden="true">→</span>'
      : '发布 <span class="ar" aria-hidden="true">→</span>';
  }

  function setDlgState(text) {
    if (momentDlgState) momentDlgState.textContent = text;
  }

  /* 分类候选：与文章编辑共用的组合框，只读取真实存在的分类。 */
  function initCategoryCombo() {
    if (!window.MyonCombo || !noteCategory || !categoryList) return;
    categoryCombo = window.MyonCombo.attach({
      input: noteCategory,
      list: categoryList,
      toggle: noteCategoryToggle,
      getOptions: function () {
        return CATEGORY_OPTIONS;
      }
    });
  }

  function openDialog(item) {
    var editing = !!item;
    if (categoryCombo) categoryCombo.close();
    state.editingId = editing ? item.id : null;
    state.visibility = editing && item.visibility === "private" ? "private" : "public";
    state.pinned = editing ? !!item.pinned : false;
    state.media = editing ? mediaOf(item) : [];
    noteText.value = editing ? item.body || "" : "";
    // 新建动态不预设分类；编辑时保留原分类（缺失才留空）。
    noteCategory.value = editing && item.category ? item.category : "";
    hideFormBanner();
    paintVisibility();
    paintPinned();
    paintMedia();
    syncCounter();
    if (momentDlgTitle) momentDlgTitle.textContent = editing ? "编辑动态" : "发动态";
    setDlgState(editing ? "编辑中" : "未发布");
    paintPublishLabel();
    if (momentDlg) {
      if (typeof momentDlg.showModal === "function") {
        if (!momentDlg.open) momentDlg.showModal();
      } else {
        momentDlg.setAttribute("open", "");
      }
    }
    noteText.focus();
  }

  function closeDialog() {
    if (!momentDlg || state.busy) return;
    if (categoryCombo) categoryCombo.close();
    if (typeof momentDlg.close === "function") {
      if (momentDlg.open) momentDlg.close();
    } else {
      momentDlg.removeAttribute("open");
    }
    state.editingId = null;
  }

  // 提交成功 / 弹窗被强制关闭时用：绕过 busy 守卫，直接收起。
  function finishDialog() {
    if (!momentDlg) return;
    if (categoryCombo) categoryCombo.close();
    if (typeof momentDlg.close === "function") {
      if (momentDlg.open) momentDlg.close();
    } else {
      momentDlg.removeAttribute("open");
    }
    state.editingId = null;
  }

  function readDialog() {
    var body = noteText.value.trim();
    var category = noteCategory.value.trim();
    if (!body) {
      showFormBanner("error", "正文不能为空", "先写点什么再发布。");
      noteText.focus();
      return null;
    }
    if (body.length > MAX_BODY) {
      showFormBanner("error", "正文超长", "最多 " + MAX_BODY + " 字，现在 " + body.length + " 字。");
      noteText.focus();
      return null;
    }
    if (!category) {
      showFormBanner("error", "分类不能为空", "填一个分类后再发布。");
      noteCategory.focus();
      return null;
    }
    var media = state.media.map(function (entry) {
      return { key: entry.key, size: entry.size || DEFAULT_MEDIA_SIZE };
    });
    var first = media[0] || null;
    return {
      body: body,
      category: category,
      visibility: state.visibility,
      pinned: state.pinned,
      media: media,
      // 旧字段同步第一张，兼容还没升级的客户端。
      mediaKey: first ? first.key : null,
      mediaSize: first ? first.size : null
    };
  }

  function submitDialog(e) {
    if (e) e.preventDefault();
    if (state.busy) return;
    var payload = readDialog();
    if (!payload) return;

    var isEdit = !!state.editingId;
    var editingId = state.editingId;
    state.busy = true;
    paintPublishLabel();
    btnPublish.textContent = isEdit ? "保存中…" : "发布中…";
    setDlgState(isEdit ? "保存中…" : "发布中…");
    hideFormBanner();

    var req = isEdit
      ? api("PATCH", MOMENTS_API + "/" + encodeURIComponent(editingId), payload)
      : api("POST", MOMENTS_API, payload);

    req.then(function (res) {
      if (res.status === 401) {
        handleAuth(res);
        showFormBanner("error", "保存失败 · 管理令牌无效", "点右上角「管理令牌」更新后重试。");
        return;
      }
      if (res.status === 503) {
        handleAuth(res);
        showFormBanner("warn", "保存失败 · 服务端未配置管理令牌", "后台写接口暂时关闭，联系站点管理员配置后重试。");
        return;
      }
      if (res.status === 400) {
        showFormBanner(
          "error",
          (isEdit ? "保存失败" : "发布失败") + " · 字段校验未通过",
          "修正下列字段后再试：",
          issueLines(res.data)
        );
        toast((isEdit ? "保存失败" : "发布失败") + " · 字段校验未通过");
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      var item = res.data && res.data.item;
      if (!item || !item.id) throw new Error("接口响应缺少 item 字段");

      hideBanner();
      state.q = "";
      state.imgOnly = false;
      noteSearch.value = "";
      paintImgToggle();
      setFilter("all");
      toast(isEdit ? "已保存修改" : "已发布 · 前台同步");
      finishDialog();

      if (isEdit) {
        loadList(false);
        return;
      }
      if (state.offset === 0) {
        state.items.push(item);
        state.total += 1;
        state.countsKnown = true;
        sortItems();
        ensureFilterOptions();
        renderRows();
        renderStats();
        renderPager();
        var newRow = null;
        each(noteList.querySelectorAll(".note-r"), function (row) {
          if (row.getAttribute("data-id") === item.id) newRow = row;
        });
        if (newRow) {
          newRow.classList.add("is-new");
          newRow.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } else {
        state.offset = 0;
        loadList(false);
      }
    }).catch(function (err) {
      showFormBanner("error", isEdit ? "保存失败" : "发布失败", (err && err.message) || "网络或服务端异常，请稍后重试。");
      toast((isEdit ? "保存失败" : "发布失败") + " · 请重试");
    }).then(function () {
      state.busy = false;
      paintPublishLabel();
      if (momentDlg && momentDlg.open) setDlgState(isEdit ? "编辑中" : "未发布");
    });
  }

  /* ================= 配图：共享媒体选择器 ================= */
  function openMediaPicker() {
    var picker = window.MyonMediaPicker;
    if (!picker || typeof picker.open !== "function") {
      toast("媒体选择器未加载，请刷新页面");
      return;
    }
    picker.open({
      mode: "pick",
      multiple: true,
      api: MEDIA_API,
      gifApi: GIF_API,
      base: MEDIA_BASE,
      // 动态入口：上传默认归入「动态」分类（cat_moments）
      categoryId: "cat_moments",
      sizes: IMAGE_SIZES,
      defaultSize: DEFAULT_MEDIA_SIZE,
      size: state.media[0] ? state.media[0].size : DEFAULT_MEDIA_SIZE,
      selectedKeys: state.media.map(function (entry) { return entry.key; }),
      onPick: function (items, size) {
        if (!Array.isArray(items)) return;
        var previous = {};
        state.media.forEach(function (entry) { previous[entry.key] = entry; });
        // 选择器是配图的权威集合：确认后按它替换；已有图保留各自尺寸。
        state.media = items
          .filter(function (item) { return item && item.key; })
          .slice(0, MOMENT_MEDIA_MAX)
          .map(function (item) {
            var old = previous[item.key];
            return {
              key: item.key,
              size: old ? old.size : (size || DEFAULT_MEDIA_SIZE),
              name: item.filename || fileName(item.key)
            };
          });
        paintMedia();
        toast("已更新配图 · " + state.media.length + " 张");
      }
    });
  }

  /* ================= 列表操作 ================= */
  function togglePin(item, btn) {
    if (state.busy) return;
    state.busy = true;
    btn.disabled = true;
    // PATCH 的 zod schema 对缺省字段会套默认值（category 会变回「日常」），
    // 所以这里显式带上整条动态，只改 pinned；多图与尺寸也要带上，避免被旧值覆盖。
    var media = mediaOf(item).map(function (entry) {
      return { key: entry.key, size: entry.size || DEFAULT_MEDIA_SIZE };
    });
    var first = media[0] || null;
    var payload = {
      body: item.body,
      category: item.category,
      visibility: item.visibility,
      pinned: !item.pinned,
      media: media,
      mediaKey: first ? first.key : null,
      mediaSize: first ? first.size : null
    };
    api("PATCH", MOMENTS_API + "/" + encodeURIComponent(item.id), payload).then(function (res) {
      if (handleAuth(res)) return;
      if (!res.ok) throw new Error("HTTP " + res.status);
      toast(item.pinned ? "已取消置顶" : "已置顶 · 列表按置顶重排");
      loadList(false);
    }).catch(function (err) {
      btn.disabled = false;
      showBanner("error", "置顶操作失败", (err && err.message) || "请稍后重试");
      toast("置顶操作失败 · 请重试");
    }).then(function () {
      state.busy = false;
      paintPublishLabel();
    });
  }

  function openConfirm(item) {
    state.pendingDelete = { id: item.id, body: item.body };
    if (!confirmDlg) return;
    confirmTitle.textContent = "删除这条动态？";
    confirmMeta.textContent = snippet(item.body, 40);
    confirmState.textContent = "";
    confirmOk.disabled = false;
    if (typeof confirmDlg.showModal === "function") {
      if (!confirmDlg.open) confirmDlg.showModal();
    } else if (window.confirm("删除这条动态？" + snippet(item.body, 40))) {
      doDelete();
    }
  }

  function doDelete() {
    var pending = state.pendingDelete;
    if (!pending) return;
    confirmOk.disabled = true;
    confirmState.textContent = "删除中…";
    api("DELETE", MOMENTS_API + "/" + encodeURIComponent(pending.id)).then(function (res) {
      if (handleAuth(res)) {
        confirmOk.disabled = false;
        confirmState.textContent = "未授权 · 需要令牌";
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.pendingDelete = null;
      if (confirmDlg && typeof confirmDlg.close === "function") confirmDlg.close();
      if (state.items.length <= 1 && state.offset > 0) state.offset = Math.max(0, state.offset - state.limit);
      toast("已删除 · 前台列表同步");
      loadList(false);
    }).catch(function (err) {
      confirmOk.disabled = false;
      confirmState.textContent = "删除失败 · 请重试";
      showBanner("error", "删除失败", (err && err.message) || "请稍后重试");
      toast("删除失败 · 请重试");
    });
  }

  /* ================= 事件绑定 ================= */
  // 页头「发动态」打开新动态弹窗；列表行「编辑」打开编辑弹窗
  btnCompose.addEventListener("click", function () {
    openDialog(null);
  });

  // 弹窗表单
  if (momentForm) momentForm.addEventListener("submit", submitDialog);
  if (momentDlg) {
    if (btnCancelMoment) btnCancelMoment.addEventListener("click", closeDialog);
    momentDlg.addEventListener("cancel", function (e) {
      // 请求还没回来时不接受 Esc 关闭，避免状态卡在提交中。
      if (state.busy) e.preventDefault();
    });
    momentDlg.addEventListener("close", function () {
      if (state.busy) return;
      state.editingId = null;
      hideFormBanner();
    });
  }

  // 可见性 / 置顶 / 正文字数
  noteCategory.addEventListener("input", function () {
    if (noteCategory.value.length > 40) noteCategory.value = noteCategory.value.slice(0, 40);
  });

  each(visPick.querySelectorAll(".moment-tag"), function (btn) {
    btn.addEventListener("click", function () {
      state.visibility = btn.getAttribute("data-vis") === "private" ? "private" : "public";
      paintVisibility();
    });
  });
  pinPick.addEventListener("click", function () {
    state.pinned = !state.pinned;
    paintPinned();
  });

  noteText.addEventListener("input", syncCounter);

  // 配图：共享媒体选择器（现有 R2 图片 + 上传，可多选）
  btnPickImage.addEventListener("click", openMediaPicker);
  if (btnClearImages) {
    btnClearImages.addEventListener("click", function () {
      state.media = [];
      paintMedia();
      toast("已移除全部配图");
    });
  }

  // 列表操作（事件委托）
  noteList.addEventListener("click", function (e) {
    var btn = e.target.closest(".nr-act");
    if (!btn) return;
    var row = btn.closest(".note-r");
    if (!row) return;
    var item = findItem(row.getAttribute("data-id"));
    if (!item) return;
    var act = btn.getAttribute("data-act");
    if (act === "edit") {
      openDialog(item);
      return;
    }
    if (act === "pin") {
      togglePin(item, btn);
      return;
    }
    if (act === "del") openConfirm(item);
  });

  // 筛选 / 搜索
  if (catSel) {
    catSel.addEventListener("change", function () {
      setFilter(catSel.value);
    });
  }
  if (imgToggle) {
    imgToggle.addEventListener("click", function () {
      state.imgOnly = !state.imgOnly;
      paintImgToggle();
      applyFilter();
    });
  }
  noteSearch.addEventListener("input", function () {
    state.q = noteSearch.value.trim().toLowerCase();
    applyFilter();
  });
  btnResetFilter.addEventListener("click", resetFilters);
  if (clearFilters) clearFilters.addEventListener("click", resetFilters);

  // 分页
  pgPrev.addEventListener("click", function () {
    if (!state.countsKnown || state.loading) return;
    if (state.offset - state.limit < 0) return;
    state.offset -= state.limit;
    loadList(false);
  });
  pgNext.addEventListener("click", function () {
    if (!state.countsKnown || state.loading) return;
    if (state.offset + state.limit >= state.total) return;
    state.offset += state.limit;
    loadList(false);
  });

  // 删除确认
  if (confirmDlg) {
    confirmOk.addEventListener("click", doDelete);
    confirmCancel.addEventListener("click", function () {
      state.pendingDelete = null;
      confirmDlg.close();
    });
  }

  /* ================= 初始化 ================= */
  initCategoryCombo();
  paintVisibility();
  paintPinned();
  paintImgToggle();
  paintMedia();
  syncCounter();
  renderRows();
  renderStats();
  renderPager();
  loadList(true);
})();
