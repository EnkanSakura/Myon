(function () {
  "use strict";

  /* ================= 常量 ================= */
  var TOKEN_KEY = "myon-admin-token";
  var PAGE_LIMIT = 20;
  var MAX_BODY = 2000;
  var MAX_UPLOAD = 8 * 1024 * 1024;
  var MAX_SOURCE_UPLOAD = 20 * 1024 * 1024;

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
  function timeNow() {
    var d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
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

  /* ================= 元素 ================= */
  var composeForm = $("composeForm");
  var composeTab = $("composeTab");
  var noteText = $("noteText");
  var noteCount = $("noteCount");
  var noteCategory = $("noteCategory");
  var noteTag = $("noteTag");
  var tagQuick = $("tagQuick");
  var visPick = $("visPick");
  var pinPick = $("pinPick");
  var btnPublish = $("btnPublish");
  var btnClear = $("btnClear");
  var btnCancelEdit = $("btnCancelEdit");
  var btnCompose = $("btnCompose");
  var btnAddImg = $("btnAddImg");
  var thumbs = $("thumbs");
  var mediaFile = $("mediaFile");
  var btnUpload = $("btnUpload");
  var mediaHint = $("mediaHint");
  var attachBox = $("attachBox");
  var attachImg = $("attachImg");
  var attachName = $("attachName");
  var btnRemoveImg = $("btnRemoveImg");

  var noteList = $("noteList");
  var noteSearch = $("noteSearch");
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
  var listState = $("listState");

  var amBanner = $("amBanner");
  var amBannerK = $("amBannerK");
  var amBannerTitle = $("amBannerTitle");
  var amBannerText = $("amBannerText");
  var NOTICE_TONES = ["notice--info", "notice--warn", "notice--ok", "notice--error"];

  var confirmDlg = $("confirmDlg");
  var confirmTitle = $("confirmTitle");
  var confirmMeta = $("confirmMeta");
  var confirmState = $("confirmState");
  var confirmOk = $("confirmOk");
  var confirmCancel = $("confirmCancel");

  var DEFAULT_CATEGORY = noteCategory ? noteCategory.value || "日常" : "日常";
  var DEFAULT_MEDIA_HINT = mediaHint ? mediaHint.textContent : "";

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
    mediaKey: null,
    mediaName: "",
    visibility: "public",
    pinned: false,
    busy: false,
    loading: false,
    loadError: "",
    mediaItems: [],
    mediaLoaded: false,
    mediaLoading: false,
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
  function setListState(text) {
    if (listState) listState.textContent = text;
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
      setListState("未授权 · 令牌无效");
      return true;
    }
    if (result.status === 503) {
      showBanner("warn", "服务端未配置管理令牌", "后台写接口暂时关闭，联系站点管理员配置后重新加载页面。");
      setListState("只读 · 服务端未配置管理令牌");
      return true;
    }
    return false;
  }

  function showIssues(data, title) {
    var issues = data && data.issues ? data.issues : [];
    var text = issues.map(function (issue) {
      return (issue.path || "字段") + "：" + issue.message;
    }).join("；") || "字段校验未通过";
    showBanner("error", title, text);
    toast(title + " · " + ((issues[0] && issues[0].path) || "字段") + " 校验未通过");
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
    row.setAttribute("data-id", item.id);
    row.setAttribute("data-tag", item.category);
    row.setAttribute("data-img", item.mediaKey ? "1" : "0");
    row.setAttribute("data-pinned", item.pinned ? "1" : "0");
    row.setAttribute("data-vis", item.visibility);
    row.setAttribute("data-text", (item.body + " " + item.category + " " + (item.tag || "")).toLowerCase());

    var time = el("div", "nr-time");
    time.appendChild(el("span", "nr-when", fmtDateTime(item.createdAt)));
    if (item.pinned) time.appendChild(el("span", "pin-tag", "置顶"));
    var isPrivate = item.visibility === "private";
    time.appendChild(el("span", isPrivate ? "self-tag is-private" : "self-tag", isPrivate ? "仅自己" : "公开"));

    var body = el("div", "nr-body", item.body);

    var thumb = el("div", "nr-thumb");
    var src = mediaSrc(item.mediaKey);
    if (src) {
      var img = document.createElement("img");
      img.src = src;
      img.alt = "动态配图缩略";
      img.loading = "lazy";
      thumb.appendChild(img);
    } else {
      thumb.classList.add("is-empty");
      thumb.appendChild(el("span", "nr-empty", "—"));
    }

    var tags = el("div", "nr-tag");
    tags.appendChild(el("span", "tag tag--dark", item.category));
    if (item.tag && item.tag !== item.category) tags.appendChild(el("span", "tag", item.tag));

    var acts = el("div", "nr-acts");
    acts.appendChild(actBtn("edit", "编辑"));
    var pinBtn = actBtn("pin", item.pinned ? "取消置顶" : "置顶");
    if (item.pinned) pinBtn.classList.add("is-on");
    acts.appendChild(pinBtn);
    acts.appendChild(actBtn("del", "删除"));

    row.appendChild(time);
    row.appendChild(body);
    row.appendChild(thumb);
    row.appendChild(tags);
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
        emptyText.textContent = "用上面的发布框发第一条。";
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
    setText("notesEn", "NOTES / " + (known ? state.total : "—"));
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

  function setFilter(value) {
    state.filter = value;
    each(document.querySelectorAll(".fb-chips .chip"), function (btn) {
      var on = btn.getAttribute("data-filter") === value;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    applyFilter();
  }

  function paintImgToggle() {
    if (!imgToggle) return;
    imgToggle.setAttribute("aria-pressed", String(state.imgOnly));
    imgToggle.classList.toggle("is-on", state.imgOnly);
  }

  function ensureFilterChips() {
    var wrap = document.querySelector(".fb-chips");
    if (!wrap) return;
    // 动态分类 chips 只按当前数据刷新，SSR 渲染的固定分类保留。
    each(wrap.querySelectorAll('.chip[data-dynamic="1"]'), function (btn) { btn.remove(); });
    var known = {};
    each(wrap.querySelectorAll(".chip"), function (btn) { known[btn.getAttribute("data-filter")] = true; });
    state.items.forEach(function (item) {
      var name = item.category;
      if (!name || known[name]) return;
      known[name] = true;
      var btn = el("button", "chip", name);
      btn.type = "button";
      btn.setAttribute("data-filter", name);
      btn.setAttribute("data-dynamic", "1");
      btn.setAttribute("aria-pressed", "false");
      wrap.appendChild(btn);
    });
    var exists = false;
    each(wrap.querySelectorAll(".chip"), function (btn) {
      if (btn.getAttribute("data-filter") === state.filter) exists = true;
    });
    if (!exists) setFilter("all");
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
      setListState("未连接 · 需要管理令牌");
      showBanner("info", "尚未连接后台", "动态列表和发布都需要管理令牌。点右上角「管理令牌」填入令牌后保存，页面会自动刷新。");
      return;
    }
    state.loading = true;
    setListState("读取中…");
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
      setListState("已连接 · " + timeNow() + " 读取");
      ensureFilterChips();
      renderRows();
      renderStats();
    }).catch(function (err) {
      state.items = [];
      state.total = 0;
      state.countsKnown = false;
      state.loadError = "读取列表失败：" + ((err && err.message) || "网络或服务端异常");
      setListState("读取失败");
      showBanner("error", "读取列表失败", (err && err.message) || "网络或服务端异常，请稍后重试。");
      renderRows();
      renderStats();
    }).then(function () {
      state.loading = false;
      renderPager();
    });
  }

  /* ================= 发布 / 编辑 ================= */
  function syncCounter() {
    setText("noteCount", noteText.value.length);
  }

  function paintVisibility() {
    each(visPick.querySelectorAll(".c-tag"), function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-vis") === state.visibility));
    });
  }

  function paintPinned() {
    pinPick.setAttribute("aria-pressed", String(state.pinned));
    pinPick.classList.toggle("is-on", state.pinned);
    pinPick.textContent = state.pinned ? "已置顶 · 点击取消" : "置顶这条";
  }

  function updateTagQuick() {
    var value = noteTag.value.trim();
    each(tagQuick.querySelectorAll(".c-tag"), function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-tag") === value));
    });
  }

  function paintMedia() {
    if (!attachBox) return;
    if (state.mediaKey) {
      attachBox.classList.add("is-on");
      attachImg.src = mediaSrc(state.mediaKey);
      attachName.textContent = state.mediaName || fileName(state.mediaKey);
    } else {
      attachBox.classList.remove("is-on");
      attachImg.removeAttribute("src");
      attachName.textContent = "未选图";
    }
    each(thumbs.querySelectorAll(".c-thumb"), function (btn) {
      btn.classList.toggle("is-on", btn.getAttribute("data-key") === state.mediaKey);
    });
  }

  function paintPublishLabel() {
    btnPublish.disabled = state.busy;
    btnPublish.innerHTML = state.editingId
      ? '保存修改 <span class="ar" aria-hidden="true">→</span>'
      : '发布 <span class="ar" aria-hidden="true">→</span>';
  }

  function resetCompose() {
    state.editingId = null;
    noteText.value = "";
    noteCategory.value = DEFAULT_CATEGORY;
    noteTag.value = "";
    state.mediaKey = null;
    state.mediaName = "";
    state.visibility = "public";
    state.pinned = false;
    paintVisibility();
    paintPinned();
    updateTagQuick();
    paintMedia();
    syncCounter();
    composeTab.textContent = "NEW NOTE / 新动态";
    btnCancelEdit.hidden = true;
    btnPublish.removeAttribute("data-busy");
    paintPublishLabel();
  }

  function fillCompose(item) {
    state.editingId = item.id;
    noteText.value = item.body;
    noteCategory.value = item.category;
    noteTag.value = item.tag || "";
    state.visibility = item.visibility === "private" ? "private" : "public";
    state.pinned = !!item.pinned;
    state.mediaKey = item.mediaKey || null;
    state.mediaName = fileName(item.mediaKey);
    paintVisibility();
    paintPinned();
    updateTagQuick();
    paintMedia();
    syncCounter();
    composeTab.textContent = "EDIT NOTE / 编辑中";
    btnCancelEdit.hidden = false;
    paintPublishLabel();
    composeForm.scrollIntoView({ behavior: "smooth", block: "center" });
    noteText.focus();
    toast("已载入编辑区 · 改完点「保存修改」");
  }

  function readCompose() {
    var body = noteText.value.trim();
    var category = noteCategory.value.trim();
    var tag = noteTag.value.trim();
    if (!body) {
      noteText.focus();
      toast("先写点什么再发");
      return null;
    }
    if (body.length > MAX_BODY) {
      noteText.focus();
      toast("正文最多 " + MAX_BODY + " 字");
      return null;
    }
    if (!category) {
      noteCategory.focus();
      toast("分类不能为空");
      return null;
    }
    return {
      body: body,
      category: category,
      tag: tag || null,
      visibility: state.visibility,
      pinned: state.pinned,
      mediaKey: state.mediaKey
    };
  }

  function submitCompose(e) {
    e.preventDefault();
    if (state.busy) return;
    var payload = readCompose();
    if (!payload) return;

    var isEdit = !!state.editingId;
    var editingId = state.editingId;
    state.busy = true;
    paintPublishLabel();
    btnPublish.textContent = isEdit ? "保存中…" : "发布中…";

    var req = isEdit
      ? api("PATCH", MOMENTS_API + "/" + encodeURIComponent(editingId), payload)
      : api("POST", MOMENTS_API, payload);

    req.then(function (res) {
      if (handleAuth(res)) return;
      if (res.status === 400) {
        showIssues(res.data, isEdit ? "保存失败" : "发布失败");
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      var item = res.data && res.data.item;
      if (!item || !item.id) throw new Error("接口响应缺少 item 字段");

      resetCompose();
      hideBanner();
      state.q = "";
      state.imgOnly = false;
      noteSearch.value = "";
      paintImgToggle();
      setFilter("all");
      toast(isEdit ? "已保存修改" : "已发布 · 前台同步");

      if (isEdit) {
        loadList(false);
        return;
      }
      if (state.offset === 0) {
        state.items.push(item);
        state.total += 1;
        state.countsKnown = true;
        sortItems();
        ensureFilterChips();
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
      showBanner("error", isEdit ? "保存失败" : "发布失败", (err && err.message) || "请稍后重试");
      toast((isEdit ? "保存失败" : "发布失败") + " · 请重试");
    }).then(function () {
      state.busy = false;
      paintPublishLabel();
    });
  }

  /* ================= 列表操作 ================= */
  function togglePin(item, btn) {
    if (state.busy) return;
    state.busy = true;
    btn.disabled = true;
    // PATCH 的 zod schema 对缺省字段会套默认值（category 会变回「日常」），
    // 所以这里显式带上整条动态，只改 pinned。
    var payload = {
      body: item.body,
      category: item.category,
      tag: item.tag || null,
      visibility: item.visibility,
      pinned: !item.pinned,
      mediaKey: item.mediaKey || null
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

  /* ================= 媒体库 ================= */
  function mediaErrorText(code) {
    var map = {
      unsupported_type: "仅支持 WebP / AVIF / SVG 最终文件",
      too_large: "转换后超过 8MB",
      empty_file: "文件为空",
      upload_failed: "服务端上传失败"
    };
    return map[code] || "";
  }

  function renderThumbs() {
    if (!thumbs) return;
    each(thumbs.querySelectorAll(".c-thumb, .c-thumbs-empty"), function (node) { node.remove(); });
    state.mediaItems.forEach(function (item) {
      var btn = el("button", "c-thumb");
      btn.type = "button";
      btn.setAttribute("data-key", item.key);
      btn.setAttribute("data-name", item.filename || item.key);
      var img = document.createElement("img");
      img.src = mediaSrc(item.key);
      img.alt = item.filename || item.key;
      img.loading = "lazy";
      btn.appendChild(img);
      if (state.mediaKey === item.key) btn.classList.add("is-on");
      thumbs.appendChild(btn);
    });
    if (state.mediaItems.length === 0) {
      thumbs.appendChild(el("p", "c-thumbs-empty", "媒体库还是空的，先上传一张。"));
    }
  }

  function loadMedia() {
    if (state.mediaLoaded || state.mediaLoading) return;
    if (!hasToken()) {
      if (mediaHint) mediaHint.textContent = "填写管理令牌后才能读取媒体库";
      return;
    }
    state.mediaLoading = true;
    if (mediaHint) mediaHint.textContent = "正在读取媒体库…";
    api("GET", MEDIA_API + "?limit=30").then(function (res) {
      if (handleAuth(res)) {
        if (mediaHint) mediaHint.textContent = "媒体库读取失败 · 需要令牌";
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.mediaLoaded = true;
      state.mediaItems = Array.isArray(res.data.items) ? res.data.items : [];
      renderThumbs();
      if (mediaHint) mediaHint.textContent = state.mediaItems.length + " 张图 · 点缩略图换图";
    }).catch(function (err) {
      if (mediaHint) mediaHint.textContent = "媒体库读取失败 · " + ((err && err.message) || "请重试");
    }).then(function () {
      state.mediaLoading = false;
    });
  }

  function selectMedia(key, name) {
    state.mediaKey = key || null;
    state.mediaName = name || fileName(key);
    paintMedia();
    if (mediaHint) {
      mediaHint.textContent = state.mediaKey ? "已选图 · " + (state.mediaName || state.mediaKey) : DEFAULT_MEDIA_HINT;
    }
  }

  function uploadMedia(file) {
    var uploader = window.MyonImageUpload;
    state.busy = true;
    btnUpload.disabled = true;
    if (mediaHint) mediaHint.textContent = "转换中 · " + file.name;
    if (!uploader) {
      state.busy = false;
      btnUpload.disabled = false;
      if (mediaHint) mediaHint.textContent = "上传组件未加载";
      toast("上传组件未加载，请刷新页面");
      return;
    }

    uploader
      .prepareImage(file, { gifApi: GIF_API })
      .then(function (prepared) {
        if (prepared.size > MAX_UPLOAD) {
          throw new Error("转换后超过 8MB 上限");
        }
        if (mediaHint) mediaHint.textContent = "上传中 · " + prepared.name;
        var form = new FormData();
        form.append("file", prepared, prepared.name);
        return api("POST", MEDIA_API, form);
      })
      .then(function (res) {
        if (handleAuth(res)) return;
        var data = res.data || {};
        if (!res.ok) {
          var message = mediaErrorText(data.error) || ("HTTP " + res.status);
          toast("上传失败 · " + message);
          if (mediaHint) mediaHint.textContent = "上传失败 · " + message;
          return;
        }
        if (!data.item || !data.item.key) {
          toast("上传失败 · 响应缺少 key");
          return;
        }
        state.mediaLoaded = false;
        selectMedia(data.item.key, data.item.filename || "image.webp");
        if (mediaHint) mediaHint.textContent = "已上传 · " + data.item.key;
        toast("图片已上传 · key 已填入");
      })
      .catch(function (err) {
        var message = (err && err.message) || "请重试";
        toast("上传失败 · " + message);
        if (mediaHint) mediaHint.textContent = "上传失败 · " + message;
      })
      .then(function () {
        state.busy = false;
        btnUpload.disabled = false;
        if (mediaFile) mediaFile.value = "";
      });
  }

  /* ================= 事件绑定 ================= */
  // 标签 / 可见性 / 置顶
  each(tagQuick.querySelectorAll(".c-tag"), function (btn) {
    btn.addEventListener("click", function () {
      var value = btn.getAttribute("data-tag");
      noteTag.value = noteTag.value.trim() === value ? "" : value;
      updateTagQuick();
    });
  });
  noteTag.addEventListener("input", updateTagQuick);
  noteCategory.addEventListener("input", function () {
    if (noteCategory.value.length > 40) noteCategory.value = noteCategory.value.slice(0, 40);
  });

  each(visPick.querySelectorAll(".c-tag"), function (btn) {
    btn.addEventListener("click", function () {
      state.visibility = btn.getAttribute("data-vis") === "private" ? "private" : "public";
      paintVisibility();
    });
  });
  pinPick.addEventListener("click", function () {
    state.pinned = !state.pinned;
    paintPinned();
  });

  // 媒体库缩略图
  thumbs.addEventListener("click", function (e) {
    var btn = e.target.closest(".c-thumb");
    if (!btn) return;
    selectMedia(btn.getAttribute("data-key"), btn.getAttribute("data-name"));
  });
  btnAddImg.addEventListener("click", function () {
    var open = thumbs.classList.toggle("is-open");
    btnAddImg.setAttribute("aria-expanded", String(open));
    if (open) loadMedia();
  });
  btnUpload.addEventListener("click", function () { mediaFile.click(); });
  mediaFile.addEventListener("change", function () {
    var file = mediaFile.files && mediaFile.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast("只支持图片文件");
      mediaFile.value = "";
      return;
    }
    if (file.size > MAX_SOURCE_UPLOAD) {
      toast("源图片超过 20MB");
      mediaFile.value = "";
      return;
    }
    uploadMedia(file);
  });
  btnRemoveImg.addEventListener("click", function () { selectMedia(null, ""); });

  // 正文计数 / 发布
  noteText.addEventListener("input", syncCounter);
  composeForm.addEventListener("submit", submitCompose);
  btnClear.addEventListener("click", function () {
    resetCompose();
    noteText.focus();
    toast("已清空草稿");
  });
  btnCancelEdit.addEventListener("click", function () {
    resetCompose();
    toast("已取消编辑");
  });

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
      fillCompose(item);
      return;
    }
    if (act === "pin") {
      togglePin(item, btn);
      return;
    }
    if (act === "del") openConfirm(item);
  });

  // 筛选 / 搜索
  var chipWrap = document.querySelector(".fb-chips");
  if (chipWrap) {
    chipWrap.addEventListener("click", function (e) {
      var btn = e.target.closest(".chip");
      if (!btn) return;
      setFilter(btn.getAttribute("data-filter"));
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

  // 页头动作
  btnCompose.addEventListener("click", function () {
    resetCompose();
    noteText.focus();
    composeForm.scrollIntoView({ behavior: "smooth", block: "center" });
    noteText.classList.add("is-flash");
    setTimeout(function () { noteText.classList.remove("is-flash"); }, 900);
  });

  // 删除确认
  if (confirmDlg) {
    confirmOk.addEventListener("click", doDelete);
    confirmCancel.addEventListener("click", function () {
      state.pendingDelete = null;
      confirmDlg.close();
    });
    confirmDlg.addEventListener("click", function (e) {
      if (e.target === confirmDlg) {
        state.pendingDelete = null;
        confirmDlg.close();
      }
    });
  }

  /* ================= 初始化 ================= */
  paintVisibility();
  paintPinned();
  paintImgToggle();
  updateTagQuick();
  paintMedia();
  syncCounter();
  renderRows();
  renderStats();
  renderPager();
  loadList(true);
})();
