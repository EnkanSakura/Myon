(function () {
  "use strict";

  /* ==========================================================================
     Myon · 后台媒体库
     - 图片文件只存 R2；分类 / 别名等元数据在 D1（/api/v1/admin/media*）。
     - 分类可自定义（分类管理弹窗），单归属；未分类用 categoryId=null。
     - 别名每张图最多 8 个、每个 30 字，搜索匹配文件名 / R2 key / 别名。
     - 列表的筛选 / 排序 / 分页全部由服务端完成（全库筛选）。
     ========================================================================== */

  /* ---------------- 常量与工具 ---------------- */
  var TOKEN_KEY = "myon-admin-token";
  var MAX_BYTES = 8 * 1024 * 1024;
  var ALIAS_MAX_COUNT = 8;
  var ALIAS_MAX_LENGTH = 30;
  var CATEGORY_NAME_MAX = 24;
  var UNCATEGORIZED = "uncategorized";
  var UPLOAD_ERRORS = {
    unsupported_type: "仅支持 JPEG / PNG / GIF / WebP / AVIF / SVG",
    too_large: "转换后超过 8MB 上限",
    empty_file: "文件是空的",
    file_required: "没有选择文件",
    invalid_form: "上传表单无效",
    upload_failed: "服务端上传失败"
  };
  var AUTH_401 = "管理令牌无效";
  var AUTH_503 = "服务端未配置管理令牌";

  var pageEl = document.querySelector(".page[data-api]");
  var API = pageEl ? pageEl.getAttribute("data-api") : "";
  var CATEGORIES_API = pageEl
    ? pageEl.getAttribute("data-categories-api") || (API ? API + "/categories" : "")
    : "";
  var GIF_API = pageEl ? pageEl.getAttribute("data-gif-api") : "";
  var STATS_API = pageEl ? pageEl.getAttribute("data-stats-api") : "";
  var MEDIA_BASE = pageEl ? pageEl.getAttribute("data-media-base") || "/media/" : "/media/";

  function $(id) { return document.getElementById(id); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  /* ---------------- 元素 ---------------- */
  var toastEl = $("toast");
  var authBanner = $("authBanner");
  var authK = $("authK");
  var authTitle = $("authTitle");
  var authText = $("authText");
  var authToken = $("authToken");
  var NOTICE_TONES = ["notice--info", "notice--warn", "notice--ok", "notice--error"];
  var btnCats = $("btnCats");
  var btnUpload = $("btnUpload");
  var fileInput = $("fileInput");
  var uploadCategory = $("uploadCategory");
  var catChips = $("catChips");
  var upList = $("upList");
  var loadingEl = $("mLoading");
  var grid = $("mediaGrid");
  var empty = $("empty");
  var emptyText = $("emptyText");
  var emptyReset = $("emptyReset");
  var batch = $("batch");
  var batchN = $("batchN");
  var batchClear = $("batchClear");
  var qInput = $("q");
  var sortSel = $("sortSel");
  var sumFiles = $("sumFiles");
  var stLine = $("stLine");
  var stCount = $("stCount");
  var stImgSeg = $("stImgSeg");
  var stAttSeg = $("stAttSeg");
  var stImg = $("stImg");
  var stAtt = $("stAtt");
  var stSize = $("stSize");
  var pgNow = $("pgNow");
  var pgPages = $("pgPages");
  var pgSize = $("pgSize");
  var pgTotal = $("pgTotal");
  var pgPrev = $("pgPrev");
  var pgNext = $("pgNext");
  var pgNums = $("pgNums");
  var fbCount = $("fbCount");
  var clearFilters = $("clearFilters");
  var delDlg = $("delDlg");
  var delDlgText = $("delDlgText");
  var delCancel = $("delCancel");
  var delOk = $("delOk");
  // 分类管理
  var catDlg = $("catDlg");
  var catList = $("catList");
  var catEmpty = $("catEmpty");
  var catName = $("catName");
  var catAdd = $("catAdd");
  var catErr = $("catErr");
  var catState = $("catState");
  var catClose = $("catClose");
  var catDelDlg = $("catDelDlg");
  var catDelText = $("catDelText");
  var catDelCancel = $("catDelCancel");
  var catDelOk = $("catDelOk");
  // 单图分类 / 别名
  var metaDlg = $("metaDlg");
  var metaForm = $("metaForm");
  var metaCategory = $("metaCategory");
  var metaAliases = $("metaAliases");
  var metaTarget = $("metaTarget");
  var metaErr = $("metaErr");
  var metaState = $("metaState");
  var metaSave = $("metaSave");
  var metaCancel = $("metaCancel");

  /* ---------------- 页面状态 ---------------- */
  var state = {
    items: [],
    total: 0,
    limit: 30,
    page: 1,
    pages: 1,
    // 分类筛选：分类 id 或 "uncategorized"；默认只看未分类，没有「全部」
    category: UNCATEGORIZED,
    q: "",
    sort: "added",
    // 分类列表：来自列表接口的 categories（含 count）；CRUD 后本地更新再重拉
    categories: [],
    uncategorizedCount: 0,
    catReady: false,
    selected: {},
    stats: null,
    loading: false,
    busy: false,
    pendingDelete: [],
    pendingMeta: null,
    pendingCatDelete: null
  };

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 3200);
  }

  /* ---------------- 令牌 / 授权 ---------------- */
  function tokenValue() { return (readStore(TOKEN_KEY) || "").trim(); }
  function setNoticeTone(tone) {
    each(NOTICE_TONES, function (name) { authBanner.classList.remove(name); });
    authBanner.classList.add("notice--" + tone);
  }
  function showAuth(tone, title, text) {
    authBanner.hidden = false;
    setNoticeTone(tone);
    authK.textContent = tone === "error" ? "ERR" : tone === "warn" ? "WARN" : "INFO";
    authTitle.textContent = title;
    authText.textContent = text;
    authToken.hidden = true;
  }
  function hideAuth() { authBanner.hidden = true; authToken.hidden = true; }

  function request(method, url, body) {
    var headers = { accept: "application/json" };
    var token = tokenValue();
    if (token) headers["x-admin-token"] = token;
    var init = { method: method, headers: headers, cache: "no-store" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(url, init);
  }
  function readJson(res) { return res.json().catch(function () { return {}; }); }

  function authFailed() {
    showAuth("error", "管理令牌无效", "令牌被拒绝，请在右上角「管理令牌」里更新后重新读取。");
    authToken.hidden = false;
    empty.hidden = false;
    emptyReset.hidden = true;
    emptyText.textContent = "未授权：管理令牌无效，重新保存令牌后再读取。";
    toast(AUTH_401);
  }
  function adminMissing() {
    showAuth("warn", "服务端未配置管理令牌", "后台写接口暂时关闭，联系站点管理员配置后重新加载页面。");
    empty.hidden = false;
    emptyReset.hidden = true;
    emptyText.textContent = "接口未开放：服务端没有配置管理令牌。";
    toast(AUTH_503);
  }

  /** 接口错误 → 可读中文：优先服务端 message / zod issues，其次回退。 */
  function serverMessage(body, fallback) {
    if (!body) return fallback || "请求失败";
    if (typeof body.message === "string" && body.message) return body.message;
    if (body.issues && body.issues.length) {
      return body.issues.map(function (issue) {
        return (issue.path || "字段") + "：" + issue.message;
      }).join("；");
    }
    if (body.error === "name_taken") return "已有同名分类";
    if (body.error === "not_found") return "资源不存在，可能已被删除";
    return fallback || "请求失败";
  }

  /* ---------------- 展示工具 ---------------- */
  function mediaUrl(key) {
    if (!key) return "";
    return MEDIA_BASE + String(key).replace(/^\/+/, "");
  }
  function absoluteUrl(key) { return location.origin + mediaUrl(key); }
  /** 网格缩略图走低清预览（长边 360px），不拉原图；外链 / 空值原样返回。 */
  function previewUrl(key) {
    var src = mediaUrl(key);
    var image = window.MyonImage;
    return image && typeof image.preview === "function"
      ? image.preview(src, 360)
      : src;
  }
  function isImage(item) {
    if (!item) return false;
    if (item.mime && String(item.mime).indexOf("image/") === 0) return true;
    return /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(item.filename || item.key || "");
  }
  function sizeLabel(bytes) {
    var n = typeof bytes === "number" && isFinite(bytes) ? bytes : 0;
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  }
  function dateTimeLabel(value) {
    if (!value) return "—";
    return String(value).slice(0, 16).replace("T", " ").replace(/-/g, ".");
  }
  function extLabel(item) {
    var name = item.filename || item.key || "";
    var dot = name.lastIndexOf(".");
    if (dot >= 0) return name.slice(dot + 1).toUpperCase();
    if (item.mime) return String(item.mime).split("/")[1].toUpperCase();
    return "FILE";
  }
  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }
  function pageCounts() {
    var img = 0;
    var att = 0;
    var size = 0;
    state.items.forEach(function (item) {
      if (isImage(item)) img++;
      else att++;
      size += typeof item.size === "number" ? item.size : 0;
    });
    return { img: img, att: att, size: size, all: state.items.length };
  }

  /* ---------------- 分类工具 ---------------- */
  function normalizeCategoryList(list) {
    var out = [];
    each(list || [], function (entry) {
      if (!entry || typeof entry.id !== "string") return;
      out.push({
        id: entry.id,
        name: typeof entry.name === "string" ? entry.name : entry.id,
        position: typeof entry.position === "number" ? entry.position : 0,
        count: typeof entry.count === "number" ? entry.count : 0
      });
    });
    out.sort(function (a, b) {
      if (a.position !== b.position) return a.position - b.position;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return out;
  }

  function categoryById(id) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].id === id) return state.categories[i];
    }
    return null;
  }

  /** 填充分类下拉：includeEmpty 时第一项是「未分类」。 */
  function fillCategorySelect(select, selectedId, includeEmpty) {
    if (!select) return;
    var previous = selectedId === undefined ? select.value : selectedId;
    var frag = document.createDocumentFragment();
    if (includeEmpty) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "未分类";
      frag.appendChild(opt);
    }
    each(state.categories, function (cat) {
      var option = document.createElement("option");
      option.value = cat.id;
      option.textContent = cat.name;
      frag.appendChild(option);
    });
    select.innerHTML = "";
    select.appendChild(frag);
    var found = false;
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === previous) found = true;
    }
    select.value = found ? previous : "";
  }

  function renderCatSelects() {
    if (uploadCategory) fillCategorySelect(uploadCategory, uploadCategory.value, true);
    if (metaDlg && metaDlg.open) {
      var selected = state.pendingMeta ? state.pendingMeta.categoryId || "" : "";
      fillCategorySelect(metaCategory, selected, true);
    }
  }

  /** 筛选 chips：未分类（默认，排第一）+ 动态分类（含计数）。 */
  function renderCatChips() {
    if (!catChips) return;
    var entries = [];
    var unc = typeof state.uncategorizedCount === "number" ? state.uncategorizedCount : 0;
    entries.push({ id: UNCATEGORIZED, name: "未分类", count: unc });
    each(state.categories, function (cat) {
      var count = typeof cat.count === "number" ? cat.count : 0;
      entries.push({ id: cat.id, name: cat.name, count: count });
    });

    catChips.innerHTML = "";
    var frag = document.createDocumentFragment();
    each(entries, function (entry) {
      var on = state.category === entry.id;
      var btn = el("button", "chip" + (on ? " is-on" : ""));
      btn.type = "button";
      btn.setAttribute("data-category", entry.id);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.appendChild(document.createTextNode(entry.name + " "));
      btn.appendChild(el("b", "", String(entry.count)));
      btn.addEventListener("click", function () {
        if (state.category === entry.id) return;
        state.category = entry.id;
        state.page = 1;
        renderCatChips();
        loadData();
      });
      frag.appendChild(btn);
    });
    catChips.appendChild(frag);
  }

  /* ---------------- 汇总 / 分页 ---------------- */
  function paintSummary() {
    var counts = pageCounts();
    var total = state.stats && state.stats.media && typeof state.stats.media.total === "number"
      ? state.stats.media.total
      : state.total;
    sumFiles.textContent = String(total);
    stLine.textContent = "图片 " + counts.img + " · 其它 " + counts.att + " · 合计 " + sizeLabel(counts.size);
    stCount.textContent = String(counts.all);
    var pct = counts.all ? Math.round((counts.img / counts.all) * 100) : 0;
    stImgSeg.style.width = pct + "%";
    stAttSeg.style.width = (counts.all ? 100 - pct : 0) + "%";
    stImg.textContent = String(counts.img);
    stAtt.textContent = String(counts.att);
    stSize.textContent = sizeLabel(counts.size);
    if ($("railMedia")) $("railMedia").textContent = String(total);
    paintFilterCount();
    paintPager();
  }

  /** 筛选栏计数：服务端过滤后的全库命中数（不是本页数量）。 */
  function paintFilterCount() {
    if (!fbCount) return;
    fbCount.textContent = "全库筛选：" + state.total + " 个";
  }

  function paintPager() {
    pgNow.textContent = String(state.page);
    pgPages.textContent = String(state.pages);
    pgSize.textContent = String(state.limit);
    pgTotal.textContent = String(state.total);
    pgPrev.disabled = state.loading || state.busy || state.page <= 1;
    pgNext.disabled = state.loading || state.busy || state.page >= state.pages;
    pgNums.innerHTML = "";
    var start = Math.max(1, Math.min(state.page - 2, state.pages - 4));
    var end = Math.min(state.pages, start + 4);
    for (var i = start; i <= end; i++) {
      var btn = el("button", "pager-btn" + (i === state.page ? " is-on" : ""), String(i));
      btn.type = "button";
      btn.setAttribute("data-page", String(i));
      pgNums.appendChild(btn);
    }
  }

  /* ---------------- 加载 / 空态 ---------------- */
  function setLoading(on) {
    state.loading = on;
    loadingEl.hidden = !on;
    grid.setAttribute("aria-busy", on ? "true" : "false");
    if (on) {
      grid.innerHTML = "";
      empty.hidden = true;
    }
    paintSummary();
  }
  function paintEmpty() {
    if (state.loading) {
      empty.hidden = true;
      return;
    }
    if (state.total === 0) {
      empty.hidden = false;
      emptyReset.hidden = false;
      var filtered = state.category !== UNCATEGORIZED || !!state.q;
      if (filtered) {
        emptyText.textContent = "没有符合条件的文件。换个分类或关键词试试。";
        emptyReset.textContent = "清除筛选";
      } else {
        emptyText.textContent = "媒体库还是空的，先上传一张图片。";
        emptyReset.textContent = "选择文件上传";
      }
    } else {
      empty.hidden = true;
    }
  }

  /* ---------------- 卡片 ---------------- */
  function attBox(item) {
    var box = el("div", "matt");
    box.appendChild(el("b", "", extLabel(item)));
    box.appendChild(el("span", "", item.mime || "文件"));
    return box;
  }

  function cardFor(item) {
    var checked = !!state.selected[item.id];
    var card = el("article", "mcard" + (checked ? " is-sel" : ""));
    card.setAttribute("data-id", item.id);
    card.setAttribute("data-type", isImage(item) ? "img" : "att");
    card.setAttribute("data-name", item.filename || item.key || "");
    card.setAttribute("data-key", item.key || "");
    card.setAttribute("data-category-id", item.categoryId || "");
    card.setAttribute("data-aliases", (item.aliases || []).join("、"));

    var thumb = el("div", "mthumb");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.className = "mcheck";
    box.checked = checked;
    box.setAttribute("aria-label", "选择 " + (item.filename || item.key));
    box.addEventListener("change", function () {
      if (box.checked) state.selected[item.id] = true;
      else delete state.selected[item.id];
      syncBatch();
      paintPager();
    });
    thumb.appendChild(box);

    if (isImage(item) && item.key) {
      var img = el("img");
      img.src = previewUrl(item.key);
      img.alt = item.filename || item.key;
      img.loading = "lazy";
      img.addEventListener("error", function () {
        img.hidden = true;
        if (!thumb.querySelector(".matt")) thumb.appendChild(attBox(item));
      });
      thumb.appendChild(img);
    } else {
      thumb.appendChild(attBox(item));
    }
    // 分类 badge：未分类用中性样式
    var catBadge = el(
      "span",
      "mcat" + (item.categoryId ? "" : " is-empty"),
      item.categoryName || "未分类"
    );
    catBadge.title = item.categoryId ? "分类：" + item.categoryName : "未分类";
    thumb.appendChild(catBadge);

    var mover = el("div", "mover");
    var copyBtn = el("button", "mo", "复制链接");
    copyBtn.type = "button";
    copyBtn.setAttribute("data-act", "copy");
    var metaBtn = el("button", "mo", "分类/别名");
    metaBtn.type = "button";
    metaBtn.setAttribute("data-act", "meta");
    var delBtn = el("button", "mo mo--del", "删除");
    delBtn.type = "button";
    delBtn.setAttribute("data-act", "del");
    mover.appendChild(copyBtn);
    mover.appendChild(metaBtn);
    mover.appendChild(delBtn);
    thumb.appendChild(mover);

    var meta = el("div", "mmeta");
    meta.appendChild(el("span", "mname", item.filename || item.key || "未命名"));
    var aliases = item.aliases || [];
    if (aliases.length) {
      var aliasWrap = el("div", "mtags");
      each(aliases, function (alias) {
        aliasWrap.appendChild(el("span", "malias", alias));
      });
      meta.appendChild(aliasWrap);
    }
    var sub = el("span", "msub");
    sub.appendChild(el("span", "", sizeLabel(item.size) + " · " + dateTimeLabel(item.createdAt)));
    sub.appendChild(el("span", "mref", item.mime || "文件"));
    meta.appendChild(sub);

    card.appendChild(thumb);
    card.appendChild(meta);
    return card;
  }

  function renderGrid() {
    grid.innerHTML = "";
    each(state.items, function (item) { grid.appendChild(cardFor(item)); });
    grid.setAttribute("aria-busy", state.loading ? "true" : "false");
    syncBatch();
    paintEmpty();
    paintSummary();
  }

  /* ---------------- 选择 / 批量 ---------------- */
  function selectedItems() {
    return state.items.filter(function (item) { return !!state.selected[item.id]; });
  }
  function syncBatch() {
    var n = selectedItems().length;
    batch.hidden = n === 0;
    batchN.textContent = String(n);
    each(grid.querySelectorAll(".mcard"), function (card) {
      var box = card.querySelector(".mcheck");
      card.classList.toggle("is-sel", !!box && box.checked);
    });
  }
  function clearSelection() {
    state.selected = {};
    each(grid.querySelectorAll(".mcheck"), function (box) { box.checked = false; });
    syncBatch();
  }

  /* ---------------- 授权失败时页面状态 ---------------- */
  function lockView(title, text) {
    state.items = [];
    state.total = 0;
    state.pages = 1;
    state.categories = [];
    state.uncategorizedCount = 0;
    state.catReady = true;
    state.selected = {};
    state.loading = false;
    loadingEl.hidden = true;
    grid.innerHTML = "";
    grid.setAttribute("aria-busy", "false");
    renderCatChips();
    renderCatSelects();
    paintSummary();
    empty.hidden = false;
    emptyReset.hidden = true;
    emptyText.textContent = title + "：" + text;
  }

  /* ---------------- 读取数据 ---------------- */
  function loadStats() {
    if (!STATS_API) return;
    fetch(STATS_API, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        if (body && body.media) state.stats = body;
        paintSummary();
      })
      .catch(function () {});
  }

  /** 列表请求：固定传分类（默认未分类），关键词 / 排序 / 分页交给服务端。 */
  function buildListUrl() {
    var params = [
      "limit=" + state.limit,
      "offset=" + (state.page - 1) * state.limit,
      "sort=" + encodeURIComponent(state.sort)
    ];
    params.push("category=" + encodeURIComponent(state.category));
    if (state.q) params.push("q=" + encodeURIComponent(state.q));
    return API + "?" + params.join("&");
  }

  function loadData() {
    if (!tokenValue()) {
      setLoading(false);
      showAuth("info", "尚未连接后台", "媒体库需要管理令牌才能读取。点右上角「管理令牌」填入令牌后保存，页面会自动刷新。");
      authToken.hidden = false;
      lockView("需要管理令牌", "填好令牌后会自动读取媒体库。");
      paintFilterCount();
      return;
    }

    setLoading(true);
    hideAuth();
    var url = buildListUrl();

    request("GET", url)
      .then(function (res) {
        return readJson(res).then(function (body) { return { res: res, body: body }; });
      })
      .then(function (result) {
        var res = result.res;
        var body = result.body;
        if (res.status === 401) { authFailed(); lockView("未授权", "令牌无效"); return; }
        if (res.status === 503) { adminMissing(); lockView("接口未开放", "服务端没有配置管理令牌"); return; }
        if (!res.ok) throw new Error("HTTP " + res.status);
        if (!body || !Array.isArray(body.items)) throw new Error("接口响应缺少 items");
        state.items = body.items;
        state.total = typeof body.total === "number" ? body.total : body.items.length;
        state.limit = typeof body.limit === "number" ? body.limit : state.limit;
        state.pages = Math.max(1, Math.ceil(state.total / state.limit));
        state.categories = normalizeCategoryList(body.categories);
        state.uncategorizedCount =
          typeof body.uncategorizedCount === "number" ? body.uncategorizedCount : 0;
        state.catReady = true;
        state.selected = {};
        if (state.page > state.pages) {
          state.page = state.pages;
          loadData();
          return;
        }
        setLoading(false);
        renderCatChips();
        renderCatSelects();
        if (catDlg && catDlg.open) renderCatList();
        renderGrid();
        loadStats();
      })
      .catch(function (err) {
        setLoading(false);
        grid.innerHTML = "";
        empty.hidden = false;
        emptyReset.hidden = false;
        emptyReset.textContent = "重新读取";
        emptyText.textContent = "读取失败：" + (err && err.message ? err.message : "网络异常") + " · 检查网络或服务端状态后重试。";
        paintFilterCount();
        toast("读取失败 · 请稍后重试");
      });
  }

  /* ---------------- 分类管理 ---------------- */
  function catActBtn(act, label) {
    var cls = "cat-act";
    if (act === "del") cls += " cat-del";
    var btn = el("button", cls, label);
    btn.type = "button";
    btn.setAttribute("data-act", act);
    return btn;
  }

  function renderCatList() {
    if (!catList) return;
    var cats = state.categories || [];
    catList.innerHTML = "";
    if (catEmpty) catEmpty.hidden = !state.catReady || cats.length > 0;
    var frag = document.createDocumentFragment();
    each(cats, function (cat, index) {
      var row = el("div", "cat-row");
      row.setAttribute("data-id", cat.id);
      row.appendChild(el("span", "cat-pos", String(index + 1)));
      var input = document.createElement("input");
      input.type = "text";
      input.className = "cat-name";
      input.value = cat.name;
      input.maxLength = CATEGORY_NAME_MAX;
      input.spellcheck = false;
      input.autocomplete = "off";
      input.setAttribute("aria-label", "分类名称");
      input.addEventListener("input", function () {
        catErr.hidden = true;
      });
      row.appendChild(input);
      row.appendChild(catActBtn("rename", "保存"));
      var up = catActBtn("up", "↑");
      if (index === 0) up.disabled = true;
      row.appendChild(up);
      var down = catActBtn("down", "↓");
      if (index === cats.length - 1) down.disabled = true;
      row.appendChild(down);
      row.appendChild(catActBtn("del", "删除"));
      frag.appendChild(row);
    });
    catList.appendChild(frag);
  }

  function showCatError(text) {
    if (!catErr) return;
    catErr.textContent = text;
    catErr.hidden = false;
    catState.textContent = "操作失败";
  }

  function openCatDlg() {
    if (!tokenValue()) {
      toast("需要管理令牌才能管理分类");
      return;
    }
    catErr.hidden = true;
    catErr.textContent = "";
    catState.textContent = "分类只存在 D1 · 图片 URL 不变";
    renderCatList();
    if (typeof catDlg.showModal === "function") {
      if (!catDlg.open) catDlg.showModal();
    } else {
      catDlg.setAttribute("open", "");
    }
    if (!state.catReady) loadData();
  }

  function closeCatDlg() {
    if (!catDlg) return;
    if (typeof catDlg.close === "function") {
      if (catDlg.open) catDlg.close();
    } else {
      catDlg.removeAttribute("open");
    }
  }

  function patchCategory(id, body) {
    return request("PATCH", CATEGORIES_API + "/" + encodeURIComponent(id), body)
      .then(function (res) {
        return readJson(res).then(function (payload) {
          return { res: res, body: payload };
        });
      })
      .then(function (result) {
        if (result.res.status === 401) { closeCatDlg(); authFailed(); return null; }
        if (result.res.status === 503) { closeCatDlg(); adminMissing(); return null; }
        return result;
      });
  }

  function addCategory() {
    if (!catName) return;
    var name = catName.value.trim();
    if (!name) {
      showCatError("分类名不能为空");
      catName.focus();
      return;
    }
    if (name.length > CATEGORY_NAME_MAX) {
      showCatError("分类名最多 " + CATEGORY_NAME_MAX + " 字");
      catName.focus();
      return;
    }
    catAdd.disabled = true;
    catState.textContent = "添加中…";
    request("POST", CATEGORIES_API, { name: name })
      .then(function (res) {
        return readJson(res).then(function (payload) { return { res: res, body: payload }; });
      })
      .then(function (result) {
        if (result.res.status === 401) { closeCatDlg(); authFailed(); return; }
        if (result.res.status === 503) { closeCatDlg(); adminMissing(); return; }
        if (!result.res.ok) {
          showCatError(serverMessage(result.body, "添加分类失败"));
          return;
        }
        var item = result.body && result.body.item;
        if (!item) throw new Error("接口响应缺少 item");
        catName.value = "";
        catErr.hidden = true;
        catState.textContent = "已添加「" + item.name + "」";
        toast("已添加分类 · " + item.name);
        loadData();
      })
      .catch(function (err) {
        showCatError((err && err.message) || "添加失败");
      })
      .then(function () {
        catAdd.disabled = false;
      });
  }

  function renameCategory(row) {
    var id = row.getAttribute("data-id");
    var input = row.querySelector(".cat-name");
    var name = input ? input.value.trim() : "";
    if (!name) {
      showCatError("分类名不能为空");
      if (input) input.focus();
      return;
    }
    if (name.length > CATEGORY_NAME_MAX) {
      showCatError("分类名最多 " + CATEGORY_NAME_MAX + " 字");
      if (input) input.focus();
      return;
    }
    catState.textContent = "保存分类名…";
    patchCategory(id, { name: name })
      .then(function (result) {
        if (!result) return;
        if (!result.res.ok) {
          showCatError(serverMessage(result.body, "改名失败"));
          return;
        }
        catErr.hidden = true;
        catState.textContent = "已改名为「" + name + "」";
        toast("分类已改名 · " + name);
        loadData();
      })
      .catch(function () {
        showCatError("改名失败 · 请重试");
      });
  }

  /** ↑ / ↓：把相邻两行的 position 重新编号后串行保存。 */
  function moveCategory(row, direction) {
    var id = row.getAttribute("data-id");
    var index = -1;
    each(state.categories, function (cat, i) {
      if (cat.id === id) index = i;
    });
    var target = index + direction;
    if (index < 0 || target < 0 || target >= state.categories.length) return;

    var list = state.categories.slice();
    var moved = list.splice(index, 1)[0];
    list.splice(target, 0, moved);
    var patches = [];
    each(list, function (cat, i) {
      if (cat.position !== i) patches.push({ id: cat.id, position: i });
      cat.position = i;
    });
    state.categories = list;
    renderCatList();
    catState.textContent = "保存顺序…";

    var chain = Promise.resolve();
    var failed = false;
    each(patches, function (patch) {
      chain = chain.then(function () {
        if (failed) return null;
        return patchCategory(patch.id, { position: patch.position }).then(function (result) {
          if (!result) { failed = true; return null; }
          if (!result.res.ok) {
            failed = true;
            showCatError(serverMessage(result.body, "排序保存失败"));
          }
          return null;
        });
      });
    });
    chain
      .then(function () {
        if (failed) return;
        catErr.hidden = true;
        catState.textContent = "顺序已保存";
        loadData();
      })
      .catch(function () {
        showCatError("排序保存失败 · 请重试");
      });
  }

  function askDeleteCategory(row) {
    var cat = categoryById(row.getAttribute("data-id"));
    if (!cat) return;
    state.pendingCatDelete = cat;
    catDelText.textContent =
      "删除分类「" + cat.name + "」？该分类下的图片会移到「未分类」，图片文件不会被删除。";
    if (typeof catDelDlg.showModal === "function") {
      if (!catDelDlg.open) catDelDlg.showModal();
    } else if (window.confirm(catDelText.textContent)) {
      confirmDeleteCategory();
    }
  }

  function confirmDeleteCategory() {
    var cat = state.pendingCatDelete;
    state.pendingCatDelete = null;
    if (typeof catDelDlg.close === "function") {
      if (catDelDlg.open) catDelDlg.close();
    }
    if (!cat) return;
    catDelOk.disabled = true;
    catState.textContent = "删除分类…";
    request("DELETE", CATEGORIES_API + "/" + encodeURIComponent(cat.id))
      .then(function (res) {
        return readJson(res).then(function (payload) { return { res: res, body: payload }; });
      })
      .then(function (result) {
        if (result.res.status === 401) { closeCatDlg(); authFailed(); return; }
        if (result.res.status === 503) { closeCatDlg(); adminMissing(); return; }
        if (!result.res.ok && result.res.status !== 404) {
          showCatError(serverMessage(result.body, "删除分类失败"));
          return;
        }
        var kept = [];
        each(state.categories, function (entry) {
          if (entry.id !== cat.id) kept.push(entry);
        });
        state.categories = kept;
        if (state.category === cat.id) state.category = UNCATEGORIZED;
        renderCatList();
        renderCatChips();
        renderCatSelects();
        catErr.hidden = true;
        catState.textContent = "已删除分类「" + cat.name + "」";
        toast("已删除分类 · 图片移到未分类");
        loadData();
      })
      .catch(function () {
        showCatError("删除分类失败 · 请重试");
      })
      .then(function () {
        catDelOk.disabled = false;
      });
  }

  /* ---------------- 单图分类 / 别名 ---------------- */
  function showMetaError(text) {
    metaErr.textContent = text;
    metaErr.hidden = false;
    metaState.textContent = "保存失败";
  }

  function openMeta(item) {
    if (!item) return;
    state.pendingMeta = item;
    metaTarget.textContent = (item.filename || item.key) + " · " + (item.categoryName || "未分类");
    fillCategorySelect(metaCategory, item.categoryId || "", true);
    metaAliases.value = (item.aliases || []).join("、");
    metaErr.textContent = "";
    metaErr.hidden = true;
    metaState.textContent = "只改 D1 元数据 · 图片 URL 不变";
    metaSave.disabled = false;
    metaSave.textContent = "保存";
    if (typeof metaDlg.showModal === "function") {
      if (!metaDlg.open) metaDlg.showModal();
    } else {
      metaDlg.setAttribute("open", "");
    }
  }

  function closeMeta() {
    state.pendingMeta = null;
    if (!metaDlg) return;
    if (typeof metaDlg.close === "function") {
      if (metaDlg.open) metaDlg.close();
    } else {
      metaDlg.removeAttribute("open");
    }
  }

  /** 别名输入：逗号 / 顿号 / 分号 / 换行分隔，去空白、去重（保留原顺序）。 */
  function parseAliasesInput(raw) {
    var out = [];
    each(String(raw || "").split(/[,，、;；\n]+/), function (piece) {
      var alias = piece.trim();
      if (alias && out.indexOf(alias) < 0) out.push(alias);
    });
    return out;
  }

  function submitMeta(event) {
    if (event) event.preventDefault();
    var item = state.pendingMeta;
    if (!item) return;
    var aliases = parseAliasesInput(metaAliases.value);
    if (aliases.length > ALIAS_MAX_COUNT) {
      showMetaError("别名最多 " + ALIAS_MAX_COUNT + " 个，现在 " + aliases.length + " 个");
      return;
    }
    var tooLong = null;
    each(aliases, function (alias) {
      if (!tooLong && alias.length > ALIAS_MAX_LENGTH) tooLong = alias;
    });
    if (tooLong) {
      showMetaError("单个别名最多 " + ALIAS_MAX_LENGTH + " 字：" + tooLong);
      return;
    }

    var categoryId = metaCategory.value || null;
    metaSave.disabled = true;
    metaSave.textContent = "保存中…";
    metaState.textContent = "正在写入 D1 元数据…";

    request("PATCH", API + "/" + encodeURIComponent(item.id), {
      categoryId: categoryId,
      aliases: aliases
    })
      .then(function (res) {
        return readJson(res).then(function (body) { return { res: res, body: body }; });
      })
      .then(function (result) {
        if (result.res.status === 401) { closeMeta(); authFailed(); return; }
        if (result.res.status === 503) { closeMeta(); adminMissing(); return; }
        if (!result.res.ok) {
          showMetaError(serverMessage(result.body, "保存失败（HTTP " + result.res.status + "）"));
          return;
        }
        var next = result.body && result.body.item;
        if (!next) throw new Error("接口响应缺少 item");
        for (var i = 0; i < state.items.length; i++) {
          if (state.items[i].id === next.id) {
            state.items[i] = next;
            break;
          }
        }
        closeMeta();
        renderGrid();
        toast("已保存 · " + (next.categoryName || "未分类"));
        loadData();
      })
      .catch(function (err) {
        showMetaError((err && err.message) || "网络异常");
      })
      .then(function () {
        metaSave.disabled = false;
        metaSave.textContent = "保存";
      });
  }

  /* ---------------- 删除媒体 ---------------- */
  function askDelete(items) {
    if (!items.length) return;
    state.pendingDelete = items.slice();
    delDlgText.textContent = items.length === 1
      ? "删除 " + (items[0].filename || items[0].key) + "？文件会被删除，引用它的图片会失效。"
      : "删除选中的 " + items.length + " 个文件？删除后不可恢复。";
    if (typeof delDlg.showModal === "function") delDlg.showModal();
  }

  function confirmDelete() {
    var list = state.pendingDelete.slice();
    state.pendingDelete = [];
    if (typeof delDlg.close === "function") delDlg.close();
    if (!list.length) return;

    state.busy = true;
    paintSummary();
    var done = 0;
    var failed = 0;
    var authStopped = false;
    var deleted = 0;

    function finish() {
      state.busy = false;
      if (authStopped) return;
      toast(failed
        ? "已删除 " + deleted + " 个，失败 " + failed + " 个"
        : "已删除 " + deleted + " 个文件");
      if (state.items.length === list.length && state.page > 1) state.page -= 1;
      loadData();
    }

    function next() {
      if (authStopped || done >= list.length) {
        finish();
        return;
      }
      var item = list[done];
      request("DELETE", API + "/" + encodeURIComponent(item.id))
        .then(function (res) {
          if (res.status === 401) { authStopped = true; authFailed(); }
          else if (res.status === 503) { authStopped = true; adminMissing(); }
          else if (res.ok || res.status === 404) deleted++;
          else failed++;
        })
        .catch(function () { failed++; })
        .then(function () {
          done += 1;
          next();
        });
    }
    next();
  }

  /* ---------------- 复制链接 ---------------- */
  function copyText(text, label) {
    var shown = label || (text.length > 90 ? text.slice(0, 90) + "…" : text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("已复制 · " + shown);
      }, function () {
        toast("复制失败 · " + shown);
      });
    } else {
      toast("链接 · " + shown);
    }
  }

  /* ---------------- 上传 ---------------- */
  function setUploading(on) {
    btnUpload.disabled = on;
    btnUpload.innerHTML = on
      ? "上传中…"
      : '上传 <span class="ar" aria-hidden="true">＋</span>';
    fileInput.disabled = on;
    if (uploadCategory) uploadCategory.disabled = on;
    if (btnCats) btnCats.disabled = on;
  }

  function addUploadRow(file) {
    var row = el("div", "up-row");
    row.appendChild(el("span", "up-name", file.name));
    var track = el("span", "up-track");
    var fill = el("span", "up-fill");
    track.appendChild(fill);
    row.appendChild(track);
    var status = el("span", "up-st", "等待中");
    row.appendChild(status);
    row._fill = fill;
    row._status = status;
    upList.appendChild(row);
    return row;
  }

  function setRow(row, text, stateName, pct) {
    row._status.textContent = text;
    if (typeof pct === "number") row._fill.style.width = pct + "%";
    row.classList.remove("is-ok", "is-err");
    if (stateName) row.classList.add(stateName);
  }

  function xhrUpload(file, categoryId, onProgress, done) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", API, true);
    var token = tokenValue();
    if (token) xhr.setRequestHeader("x-admin-token", token);
    xhr.upload.onprogress = function (event) {
      if (!event.lengthComputable) return;
      var pct = Math.round((event.loaded / event.total) * 100);
      onProgress(Math.max(0, Math.min(100, pct)));
    };
    xhr.onerror = function () { done("网络中断"); };
    xhr.onload = function () {
      var body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch (e) {}
      if (xhr.status === 401) { authFailed(); done(AUTH_401); return; }
      if (xhr.status === 503) { adminMissing(); done(AUTH_503); return; }
      if (xhr.status === 201 && body.item) { done(null); return; }
      var code = body && body.error;
      done(UPLOAD_ERRORS[code] || ("上传失败（HTTP " + xhr.status + "）"));
    };
    var form = new FormData();
    form.append("file", file, file.name);
    if (categoryId) form.append("categoryId", categoryId);
    xhr.send(form);
  }

  function uploadFiles(files) {
    if (state.busy) {
      toast("正在上传，请稍候");
      return;
    }
    state.busy = true;
    setUploading(true);
    upList.hidden = false;
    upList.innerHTML = "";
    // 上传分类：下拉框选择；空值 = 未分类
    var categoryId = uploadCategory && uploadCategory.value ? uploadCategory.value : "";
    var queue = files.slice();
    var ok = 0;
    var failed = 0;
    var authStopped = false;
    var uploader = window.MyonImageUpload;

    function finish() {
      state.busy = false;
      setUploading(false);
      if (authStopped) return;
      toast("上传结束 · 成功 " + ok + " 张，失败 " + failed + " 张");
      if (ok > 0) {
        state.page = 1;
        loadData();
      }
    }

    function next() {
      if (authStopped) {
        finish();
        return;
      }
      var file = queue.shift();
      if (!file) {
        finish();
        return;
      }
      var row = addUploadRow(file);
      if (!file.size) {
        failed++;
        setRow(row, "失败 · " + UPLOAD_ERRORS.empty_file, "is-err", 0);
        next();
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        failed++;
        setRow(row, "失败 · 源文件超过 20MB", "is-err", 0);
        next();
        return;
      }
      if (!uploader) {
        failed++;
        setRow(row, "失败 · 上传组件未加载", "is-err", 0);
        next();
        return;
      }

      setRow(row, "转换中…", null, 0);
      uploader
        .prepareImage(file, { gifApi: GIF_API })
        .then(function (prepared) {
          if (prepared.size > MAX_BYTES) {
            throw new Error(UPLOAD_ERRORS.too_large);
          }
          setRow(row, "上传中 0%", null, 0);
          return new Promise(function (resolve) {
            xhrUpload(prepared, categoryId, function (pct) {
              setRow(row, "上传中 " + pct + "%", null, pct);
            }, function (error) {
              if (error) {
                failed++;
                setRow(row, "失败 · " + error, "is-err", 100);
                if (error === AUTH_401 || error === AUTH_503) authStopped = true;
              } else {
                ok++;
                setRow(row, "完成", "is-ok", 100);
              }
              resolve();
            });
          });
        })
        .catch(function (error) {
          failed++;
          setRow(
            row,
            "失败 · " + ((error && error.message) || "转换失败"),
            "is-err",
            0,
          );
        })
        .then(next);
    }
    next();
  }

  /* ---------------- 筛选重置 ---------------- */
  function resetFilters() {
    state.category = UNCATEGORIZED;
    state.q = "";
    state.sort = "added";
    state.page = 1;
    qInput.value = "";
    sortSel.value = "added";
    if (uploadCategory) uploadCategory.value = "";
    renderCatChips();
    loadData();
  }

  /* ---------------- 事件绑定 ---------------- */
  btnCats.addEventListener("click", openCatDlg);
  catClose.addEventListener("click", closeCatDlg);
  catAdd.addEventListener("click", addCategory);
  catName.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      addCategory();
    }
  });
  catList.addEventListener("click", function (event) {
    var btn = event.target.closest(".cat-act");
    if (!btn) return;
    var row = btn.closest(".cat-row");
    if (!row) return;
    var act = btn.getAttribute("data-act");
    if (act === "rename") renameCategory(row);
    else if (act === "up") moveCategory(row, -1);
    else if (act === "down") moveCategory(row, 1);
    else if (act === "del") askDeleteCategory(row);
  });
  catList.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    var row = event.target.closest(".cat-row");
    if (!row || !event.target.classList.contains("cat-name")) return;
    event.preventDefault();
    renameCategory(row);
  });
  catDelCancel.addEventListener("click", function () {
    state.pendingCatDelete = null;
    if (typeof catDelDlg.close === "function") catDelDlg.close();
  });
  catDelOk.addEventListener("click", confirmDeleteCategory);

  metaForm.addEventListener("submit", submitMeta);
  metaCancel.addEventListener("click", closeMeta);
  metaDlg.addEventListener("close", function () {
    state.pendingMeta = null;
  });

  btnUpload.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    var files = Array.prototype.slice.call(fileInput.files || []);
    fileInput.value = "";
    if (files.length) uploadFiles(files);
  });

  grid.addEventListener("click", function (event) {
    var action = event.target.closest(".mover button");
    if (action) {
      var actionCard = action.closest(".mcard");
      var actionItem = actionCard ? findItem(actionCard.getAttribute("data-id")) : null;
      if (!actionItem) return;
      var act = action.getAttribute("data-act");
      if (act === "copy") copyText(absoluteUrl(actionItem.key));
      else if (act === "meta") openMeta(actionItem);
      else askDelete([actionItem]);
      return;
    }
    if (event.target.classList.contains("mcheck")) return;
    if (event.target.closest(".mover")) return;
    var card = event.target.closest(".mcard");
    if (!card) return;
    var item = findItem(card.getAttribute("data-id"));
    var box = card.querySelector(".mcheck");
    if (!item || !box) return;
    box.checked = !box.checked;
    if (box.checked) state.selected[item.id] = true;
    else delete state.selected[item.id];
    syncBatch();
    paintPager();
  });

  // 搜索交给服务端（文件名 / R2 key / 别名），输入 300ms 防抖
  var searchTimer = null;
  qInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var next = qInput.value.trim();
      if (next === state.q) return;
      state.q = next;
      state.page = 1;
      loadData();
    }, 300);
  });
  sortSel.addEventListener("change", function () {
    var next = sortSel.value;
    if (next === state.sort) return;
    state.sort = next;
    state.page = 1;
    loadData();
  });
  clearFilters.addEventListener("click", resetFilters);

  emptyReset.addEventListener("click", function () {
    var filtered = state.category !== UNCATEGORIZED || !!state.q;
    if (!filtered && !state.loading && state.total === 0) fileInput.click();
    else resetFilters();
  });

  batchClear.addEventListener("click", clearSelection);
  each(document.querySelectorAll(".batch-btn"), function (btn) {
    btn.addEventListener("click", function () {
      var items = selectedItems();
      if (!items.length) return;
      if (btn.getAttribute("data-act") === "copy") {
        copyText(
          items.map(function (item) { return absoluteUrl(item.key); }).join("\n"),
          items.length + " 个链接"
        );
      } else {
        askDelete(items);
      }
    });
  });

  pgPrev.addEventListener("click", function () {
    if (state.loading || state.busy || state.page <= 1) return;
    state.page -= 1;
    loadData();
  });
  pgNext.addEventListener("click", function () {
    if (state.loading || state.busy || state.page >= state.pages) return;
    state.page += 1;
    loadData();
  });
  pgNums.addEventListener("click", function (event) {
    var btn = event.target.closest(".pager-btn[data-page]");
    if (!btn) return;
    var page = parseInt(btn.getAttribute("data-page"), 10);
    if (isNaN(page) || state.loading || state.busy || page === state.page) return;
    state.page = page;
    loadData();
  });

  delCancel.addEventListener("click", function () {
    state.pendingDelete = [];
    if (typeof delDlg.close === "function") delDlg.close();
  });
  delOk.addEventListener("click", confirmDelete);

  /* ---------------- 初始化 ---------------- */
  sortSel.value = state.sort;
  renderCatChips();
  renderCatSelects();
  paintSummary();
  loadData();
})();
