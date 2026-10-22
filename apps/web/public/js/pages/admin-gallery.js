(function () {
  "use strict";

  /* ---------------- 常量与工具 ---------------- */
  var TOKEN_KEY = "myon-admin-token";
  var MEDIA_PREFIX = "/media/";

  var pageEl = document.querySelector(".page[data-api]");
  var API = pageEl ? pageEl.getAttribute("data-api") : "";
  var STATS_API = pageEl ? pageEl.getAttribute("data-stats-api") : "";

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

  /* ---------------- 元素 ---------------- */
  var toastEl = $("toast");
  var tokenInput = $("tokenInput");
  var tokenState = $("tokenState");
  var authBanner = $("authBanner");
  var authK = $("authK");
  var authTitle = $("authTitle");
  var authText = $("authText");
  var NOTICE_TONES = ["notice--info", "notice--warn", "notice--ok", "notice--error"];
  var grid = $("galGrid");
  var loadingEl = $("galLoading");
  var stateEl = $("galState");
  var stateK = $("galStateK");
  var stateTitle = $("galStateTitle");
  var stateText = $("galStateText");
  var retryBtn = $("galRetry");
  var catBtns = $("catBtns");
  var galCount = $("galCount");
  var galPageNote = $("galPageNote");
  var sortSelect = $("galSortSelect");
  var pgNow = $("pgNow");
  var pgPages = $("pgPages");
  var pgSize = $("pgSize");
  var pgTotal = $("pgTotal");
  var pgPrev = $("pgPrev");
  var pgNext = $("pgNext");
  var slotMap = $("slotMap");
  var occCount = $("occCount");
  var emptyCount = $("emptyCount");
  var spTag = $("spTag");
  var recentList = $("recentList");
  var selNo = $("selNo");
  var selName = $("selName");
  var selMeta = $("selMeta");
  var selSt = $("selSt");
  var btnEditSel = $("btnEditSel");
  var btnToggleSel = $("btnToggleSel");
  var btnDelSel = $("btnDelSel");
  var editDlg = $("editDlg");
  var editForm = $("editForm");
  var editDlgTab = $("editDlgTab");
  var editDlgTitle = $("editDlgTitle");
  var editMode = $("editMode");
  var editErr = $("editErr");
  var editSubmit = $("editSubmit");
  var editCancel = $("editCancel");
  var editPreview = $("editPreview");
  var editPreviewImg = $("editPreviewImg");
  var editPreviewText = $("editPreviewText");
  var delDlg = $("delDlg");
  var delDlgText = $("delDlgText");
  var delCancel = $("delCancel");
  var delOk = $("delOk");

  /* ---------------- 页面状态 ---------------- */
  var state = {
    items: [],
    stats: null,
    total: 0,
    limit: 20,
    page: 1,
    pages: 1,
    filter: "全部",
    sort: "slot",
    selectedId: null,
    loading: false,
    saving: false,
    editing: null,
    pendingDelete: null
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
  function setTokenState(text) { tokenState.textContent = text; }
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
  }
  function hideAuth() { authBanner.hidden = true; }

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
    setLoading(false);
    setTokenState("令牌无效");
    grid.innerHTML = "";
    showAuth("error", "管理令牌无效（401）", "令牌被服务端拒绝。检查 ADMIN_TOKEN 是否与 .dev.vars / Worker 环境变量一致，改好后点「保存令牌」。");
    showState("LOCK", "未授权", "令牌无效，重新填写后再读取展柜。", true);
    toast("401 · 管理令牌无效");
  }
  function adminMissing() {
    setLoading(false);
    setTokenState("服务端只读");
    grid.innerHTML = "";
    showAuth("warn", "服务端未配置 ADMIN_TOKEN（503）", "在本地 .dev.vars 或 Worker 环境变量里配置 ADMIN_TOKEN 后重新加载页面。");
    showState("LOCK", "接口未开放", "服务端没有配置 ADMIN_TOKEN，后台写接口暂时关闭。", true);
    toast("503 · 服务端未配置 ADMIN_TOKEN");
  }

  /* ---------------- 展示工具 ---------------- */
  function mediaUrl(key) {
    if (!key) return "";
    return MEDIA_PREFIX + String(key).replace(/^\/+/, "");
  }
  function formatDate(value) {
    return value ? String(value).slice(0, 10).replace(/-/g, ".") : "—";
  }
  function metaLine(item) {
    return [item.category, item.era, "排序位 " + item.position, "入藏 " + formatDate(item.createdAt)]
      .filter(Boolean)
      .join(" · ");
  }
  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }
  function findCard(id) {
    var cards = grid.querySelectorAll(".g-card");
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-id") === id) return cards[i];
    }
    return null;
  }
  function defaultCategory() {
    if (state.items.length) return state.items[0].category;
    if (state.stats && state.stats.gallery && state.stats.gallery.categories.length) {
      return state.stats.gallery.categories[0].name;
    }
    return "手办";
  }
  function categoryNames() {
    var names = [];
    state.items.forEach(function (item) {
      if (names.indexOf(item.category) < 0) names.push(item.category);
    });
    if (state.stats && state.stats.gallery && state.stats.gallery.categories) {
      state.stats.gallery.categories.forEach(function (cat) {
        if (names.indexOf(cat.name) < 0) names.push(cat.name);
      });
    }
    return names;
  }

  /* ---------------- 页头 / 分页 ---------------- */
  function displayedCount() {
    if (state.stats && state.stats.gallery && typeof state.stats.gallery.displayed === "number") {
      return state.stats.gallery.displayed;
    }
    var n = 0;
    state.items.forEach(function (item) { if (item.displayed) n++; });
    return n;
  }
  function paintHeader() {
    var gallery = state.stats && state.stats.gallery ? state.stats.gallery : null;
    var total = gallery && typeof gallery.total === "number" ? gallery.total : state.total;
    var shown = displayedCount();
    $("gTotal").textContent = String(total);
    $("gShown").textContent = String(shown);
    $("stickerShown").textContent = String(shown);
    $("shownCount").textContent = String(shown);
    $("totalCount").textContent = String(total);
    var cats = gallery && gallery.categories && gallery.categories.length
      ? gallery.categories
      : null;
    if (cats) {
      $("gCats").textContent = cats.map(function (c) { return c.name + " " + c.count; }).join(" / ");
    } else {
      var names = categoryNames();
      $("gCats").textContent = names.length ? names.join(" / ") : "还没有分类";
    }
    galPageNote.textContent = "本页 " + state.items.length + " 件 · 第 " + state.page + " / " + state.pages + " 页";
    pgNow.textContent = String(state.page);
    pgPages.textContent = String(state.pages);
    pgSize.textContent = String(state.limit);
    pgTotal.textContent = String(total);
    pgPrev.disabled = state.loading || state.page <= 1;
    pgNext.disabled = state.loading || state.page >= state.pages;
    if ($("railGallery")) $("railGallery").textContent = String(total);
  }

  /* ---------------- 空 / 错误 / 加载态 ---------------- */
  function showState(kind, title, text, retry) {
    stateEl.hidden = false;
    stateK.textContent = kind;
    stateTitle.textContent = title;
    stateText.textContent = text;
    retryBtn.hidden = !retry;
  }
  function hideState() { stateEl.hidden = true; }
  function setLoading(on) {
    state.loading = on;
    loadingEl.hidden = !on;
    grid.setAttribute("aria-busy", on ? "true" : "false");
    if (on) {
      grid.innerHTML = "";
      hideState();
    }
    paintHeader();
  }

  /* ---------------- 分类筛选 ---------------- */
  function visibleItems() {
    var list = state.items.filter(function (item) {
      return state.filter === "全部" || item.category === state.filter;
    });
    if (state.sort === "name") {
      list.sort(function (a, b) { return a.name.localeCompare(b.name, "zh-Hans-CN"); });
    } else if (state.sort === "new") {
      list.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    } else {
      list.sort(function (a, b) {
        return a.position - b.position || String(a.no).localeCompare(String(b.no));
      });
    }
    return list;
  }

  function catButton(name, count, on) {
    var btn = el("button", "cat" + (on ? " is-on" : ""));
    btn.type = "button";
    btn.setAttribute("data-cat", name);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.appendChild(document.createTextNode(name + " "));
    btn.appendChild(el("b", "", count));
    return btn;
  }
  function renderCats() {
    catBtns.innerHTML = "";
    var counts = {};
    state.items.forEach(function (item) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    });
    var names = Object.keys(counts);
    if (state.filter !== "全部" && names.indexOf(state.filter) < 0) state.filter = "全部";
    catBtns.appendChild(catButton("全部", state.items.length, state.filter === "全部"));
    names.forEach(function (name) {
      catBtns.appendChild(catButton(name, counts[name], state.filter === name));
    });
    galCount.textContent = "显示 " + visibleItems().length + " 件（本页）";
  }

  /* ---------------- 藏品卡片 ---------------- */
  function itemCard(item) {
    var card = el("article", "g-card" + (item.displayed ? "" : " is-off") + (item.id === state.selectedId ? " is-sel" : ""));
    card.setAttribute("data-id", item.id);
    card.setAttribute("data-cat", item.category);
    card.setAttribute("data-no", item.no);
    card.setAttribute("data-name", item.name);
    card.setAttribute("data-slot", String(item.position));
    card.setAttribute("data-status", item.displayed ? "on" : "off");
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", item.no + " " + item.name);

    var thumb = el("div", "g-thumb");
    if (item.mediaKey) {
      var img = el("img");
      img.alt = item.name;
      img.loading = "lazy";
      img.src = mediaUrl(item.mediaKey);
      img.addEventListener("error", function () {
        img.hidden = true;
        if (!thumb.querySelector(".g-nofig")) thumb.appendChild(noFig());
      });
      thumb.appendChild(img);
    } else {
      thumb.appendChild(noFig());
    }
    if (item.position > 0) thumb.appendChild(el("span", "g-slot", String(item.position)));

    var info = el("div", "g-info");
    var row = el("div", "g-row");
    row.appendChild(el("span", "", item.no));
    var status = el("span", "g-st");
    status.appendChild(el("i"));
    status.appendChild(document.createTextNode(item.displayed ? "已陈列" : "未陈列"));
    row.appendChild(status);
    info.appendChild(row);
    info.appendChild(el("h3", "g-name", item.name));
    info.appendChild(el("p", "g-meta", metaLine(item)));

    var acts = el("div", "g-acts");
    acts.appendChild(actBtn("edit", "编辑"));
    acts.appendChild(actBtn("toggle", item.displayed ? "下架" : "上架"));
    acts.appendChild(actBtn("del", "删除"));
    info.appendChild(acts);

    card.appendChild(thumb);
    card.appendChild(info);
    return card;
  }
  function noFig() {
    var box = el("div", "g-nofig");
    box.appendChild(el("b", "", "未拍摄"));
    box.appendChild(el("span", "", "NO IMAGE"));
    return box;
  }
  function actBtn(act, label) {
    var btn = el("button", "g-act", label);
    btn.type = "button";
    btn.setAttribute("data-act", act);
    return btn;
  }

  function renderGrid() {
    grid.innerHTML = "";
    var list = visibleItems();
    list.forEach(function (item) { grid.appendChild(itemCard(item)); });
    grid.setAttribute("aria-busy", state.loading ? "true" : "false");
    if (state.loading) return;

    if (!findItem(state.selectedId) || list.indexOf(findItem(state.selectedId)) < 0) {
      state.selectedId = list.length ? list[0].id : null;
    }
    paintSelection();
    renderSlots();
    if (state.total === 0) {
      showState("EMPTY", "展柜还空着", "还没有藏品，点右上角「新增藏品」放第一件进来。", false);
    } else if (list.length === 0) {
      showState("FILTER", "这个分类本页没有", "换个分类，或点「全部」看看。", false);
    } else {
      hideState();
    }
  }

  /* ---------------- 选中详情 ---------------- */
  function paintSelection() {
    var item = findItem(state.selectedId);
    each(grid.querySelectorAll(".g-card"), function (card) {
      card.classList.toggle("is-sel", card.getAttribute("data-id") === state.selectedId);
    });
    if (!item) {
      selNo.textContent = "—";
      selName.textContent = "未选择";
      selMeta.textContent = "从左侧点一件藏品。";
      selSt.innerHTML = '<i aria-hidden="true"></i>—';
      btnEditSel.disabled = true;
      btnToggleSel.disabled = true;
      btnDelSel.disabled = true;
      btnToggleSel.textContent = "上架";
      return;
    }
    selNo.textContent = item.no;
    selName.textContent = item.name;
    selMeta.textContent = metaLine(item);
    selSt.innerHTML = '<i aria-hidden="true"></i>' + (item.displayed ? "已陈列" : "未陈列");
    btnEditSel.disabled = false;
    btnToggleSel.disabled = false;
    btnDelSel.disabled = false;
    btnToggleSel.textContent = item.displayed ? "下架" : "上架";
  }
  function selectItem(id, scroll) {
    state.selectedId = id;
    paintSelection();
    renderSlots();
    if (scroll) {
      var card = findCard(id);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  /* ---------------- 柜位图 / 最近入藏 ---------------- */
  function renderSlots() {
    slotMap.innerHTML = "";
    var selected = findItem(state.selectedId);
    var occupied = 0;
    for (var n = 1; n <= 9; n++) {
      var found = null;
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].position === n) { found = state.items[i]; break; }
      }
      var classes = "slot";
      if (found) classes += " is-occ";
      if (found && selected && selected.id === found.id) classes += " is-focus";
      var btn = el("button", classes);
      btn.type = "button";
      btn.setAttribute("data-slot", String(n));
      btn.appendChild(el("span", "no", n));
      btn.appendChild(el("span", "nm", found ? found.no : "空"));
      slotMap.appendChild(btn);
      if (found) occupied++;
    }
    occCount.textContent = String(occupied);
    emptyCount.textContent = String(9 - occupied);
    spTag.textContent = "第 1–9 位";
  }

  function renderRecent() {
    recentList.innerHTML = "";
    var list = state.items.slice().sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    }).slice(0, 3);
    if (!list.length) {
      recentList.appendChild(el("p", "empty empty--inline", "还没有藏品。"));
      return;
    }
    list.forEach(function (item) {
      var row = el("button", "recent-row");
      row.type = "button";
      row.setAttribute("data-id", item.id);
      row.appendChild(el("span", "", item.no));
      row.appendChild(el("span", "rn-name", item.name));
      row.appendChild(el("span", "rn-date", formatDate(item.createdAt)));
      recentList.appendChild(row);
    });
  }

  /* ---------------- 读取数据 ---------------- */
  function renderAll() {
    paintHeader();
    renderCats();
    renderGrid();
    renderSlots();
    renderRecent();
  }

  function loadStats() {
    if (!STATS_API) return;
    fetch(STATS_API, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        if (body && body.gallery) state.stats = body;
        paintHeader();
        renderCatOptions();
      })
      .catch(function () {});
  }

  function loadData() {
    if (!tokenValue()) {
      setLoading(false);
      state.items = [];
      state.total = 0;
      state.pages = 1;
      state.selectedId = null;
      grid.innerHTML = "";
      setTokenState("未填写");
      showAuth("info", "尚未填写管理令牌", "在页面上方填入 ADMIN_TOKEN 后保存；令牌只存在本机浏览器 localStorage（myon-admin-token），请求时放在 x-admin-token 头里。");
      showState("LOCK", "需要管理令牌", "填好令牌后会自动读取展柜数据。", false);
      renderAll();
      return;
    }

    setLoading(true);
    hideAuth();
    setTokenState("校验中…");
    var offset = (state.page - 1) * state.limit;
    var url = API + "?limit=" + state.limit + "&offset=" + offset;

    request("GET", url)
      .then(function (res) {
        return readJson(res).then(function (body) { return { res: res, body: body }; });
      })
      .then(function (result) {
        var res = result.res;
        var body = result.body;
        if (res.status === 401) { authFailed(); return; }
        if (res.status === 503) { adminMissing(); return; }
        if (!res.ok) throw new Error("HTTP " + res.status);
        if (!body || !Array.isArray(body.items)) throw new Error("接口响应缺少 items");
        state.items = body.items;
        state.total = typeof body.total === "number" ? body.total : body.items.length;
        state.limit = typeof body.limit === "number" ? body.limit : state.limit;
        state.pages = Math.max(1, Math.ceil(state.total / state.limit));
        if (state.page > state.pages) {
          state.page = state.pages;
          loadData();
          return;
        }
        setLoading(false);
        setTokenState("已连接");
        renderAll();
        loadStats();
      })
      .catch(function (err) {
        setLoading(false);
        grid.innerHTML = "";
        setTokenState("读取失败");
        showState("ERR", "读取失败", (err && err.message ? err.message : "网络异常") + " · 检查 Worker 与本地 D1 是否在运行。", true);
        toast("读取失败 · 请稍后重试");
      });
  }

  /* ---------------- 弹层：新增 / 编辑 ---------------- */
  function renderCatOptions() {
    var list = $("catList");
    list.innerHTML = "";
    categoryNames().forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      list.appendChild(option);
    });
  }

  function hideFormError() {
    editErr.hidden = true;
    each(document.querySelectorAll(".gfld.is-invalid"), function (fld) {
      fld.classList.remove("is-invalid");
    });
  }
  function showFormError(message, fieldId) {
    editErr.textContent = message;
    editErr.hidden = false;
    if (fieldId && $(fieldId)) {
      var fld = $(fieldId).closest(".gfld");
      if (fld) fld.classList.add("is-invalid");
      $(fieldId).focus();
    }
  }

  function updatePreview() {
    var key = $("fMedia").value.trim();
    if (!key) {
      editPreview.hidden = true;
      return;
    }
    editPreview.hidden = false;
    editPreviewText.textContent = key + " → " + mediaUrl(key);
    editPreviewImg.hidden = false;
    editPreviewImg.onload = function () { editPreviewImg.hidden = false; };
    editPreviewImg.onerror = function () {
      editPreviewImg.hidden = true;
      editPreviewText.textContent = key + " · 图片加载失败（key 可能不存在）";
    };
    editPreviewImg.src = mediaUrl(key);
  }

  function openEditor(item) {
    state.editing = item || null;
    state.saving = false;
    editDlgTab.textContent = item ? "EDIT" : "NEW";
    editDlgTitle.textContent = item ? "编辑藏品" : "新增藏品";
    editMode.textContent = (item ? "PATCH " : "POST ") + API;
    $("fNo").value = item ? item.no : "";
    $("fName").value = item ? item.name : "";
    $("fCat").value = item ? item.category : defaultCategory();
    $("fEra").value = item && item.era ? item.era : "";
    $("fPos").value = String(item ? item.position : 0);
    $("fMedia").value = item && item.mediaKey ? item.mediaKey : "";
    $("fNote").value = item && item.note ? item.note : "";
    $("fDisplayed").checked = item ? !!item.displayed : false;
    hideFormError();
    renderCatOptions();
    updatePreview();
    editSubmit.disabled = false;
    editSubmit.textContent = "保存";
    if (typeof editDlg.showModal === "function") editDlg.showModal();
    $("fNo").focus();
  }
  function closeEditor() {
    state.editing = null;
    if (typeof editDlg.close === "function") editDlg.close();
  }

  function readForm() {
    var position = parseInt($("fPos").value, 10);
    if (isNaN(position)) position = 0;
    return {
      no: $("fNo").value.trim(),
      name: $("fName").value.trim(),
      category: $("fCat").value.trim(),
      era: $("fEra").value.trim() || null,
      note: $("fNote").value.trim() || null,
      mediaKey: $("fMedia").value.trim() || null,
      displayed: $("fDisplayed").checked,
      position: position
    };
  }
  function validateForm(data) {
    if (!data.no) return { message: "编号不能为空。", field: "fNo" };
    if (!data.name) return { message: "名称不能为空。", field: "fName" };
    if (!data.category) return { message: "分类不能为空。", field: "fCat" };
    if (data.position < 0 || data.position > 9999) {
      return { message: "排序需要是 0–9999 的整数。", field: "fPos" };
    }
    return null;
  }

  var FIELD_BY_PATH = {
    no: "fNo",
    name: "fName",
    category: "fCat",
    era: "fEra",
    note: "fNote",
    mediaKey: "fMedia",
    position: "fPos"
  };
  function issueText(body) {
    if (body && body.issues && body.issues.length) {
      return body.issues.map(function (issue) {
        return (issue.path ? issue.path + "：" : "") + issue.message;
      }).join("；");
    }
    return "";
  }
  function issueField(body) {
    var first = body && body.issues && body.issues[0];
    return first && FIELD_BY_PATH[first.path] ? FIELD_BY_PATH[first.path] : null;
  }

  function submitEditor(event) {
    event.preventDefault();
    if (state.saving) return;
    var data = readForm();
    var bad = validateForm(data);
    if (bad) {
      showFormError(bad.message, bad.field);
      return;
    }
    hideFormError();
    state.saving = true;
    editSubmit.disabled = true;
    editSubmit.textContent = "保存中…";

    var editing = state.editing;
    var method = editing ? "PATCH" : "POST";
    var url = editing ? API + "/" + encodeURIComponent(editing.id) : API;

    request(method, url, data)
      .then(function (res) {
        return readJson(res).then(function (body) {
          return { status: res.status, ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 401) { closeEditor(); authFailed(); return; }
        if (result.status === 503) { closeEditor(); adminMissing(); return; }
        if (result.status === 409) {
          showFormError("编号已被占用，换一个 NO。", "fNo");
          return;
        }
        if (result.status === 400) {
          showFormError(issueText(result.body) || "字段校验未通过。", issueField(result.body));
          return;
        }
        if (!result.ok) throw new Error("HTTP " + result.status);
        var item = result.body && result.body.item ? result.body.item : null;
        if (editing) {
          toast("已保存 " + data.no + " · 前台同步");
          if (item) state.selectedId = item.id;
        } else {
          toast("已新增 " + data.no + (data.displayed ? " · 已上架" : " · 先未上架"));
          state.page = 1;
          state.filter = "全部";
          if (item) state.selectedId = item.id;
        }
        closeEditor();
        loadData();
      })
      .catch(function (err) {
        showFormError("保存失败：" + (err && err.message ? err.message : "网络异常"));
        toast("保存失败 · 请重试");
      })
      .then(function () {
        state.saving = false;
        editSubmit.disabled = false;
        editSubmit.textContent = "保存";
      });
  }

  /* ---------------- 上下架 / 删除 ---------------- */
  function toggleItem(item) {
    if (!item) return;
    var next = !item.displayed;
    request("PATCH", API + "/" + encodeURIComponent(item.id), { displayed: next })
      .then(function (res) {
        return readJson(res).then(function (body) {
          return { status: res.status, ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 401) { authFailed(); return; }
        if (result.status === 503) { adminMissing(); return; }
        if (!result.ok) throw new Error("HTTP " + result.status);
        item.displayed = result.body && result.body.item ? !!result.body.item.displayed : next;
        renderAll();
        toast(item.displayed ? "已上架 · 前台展柜可见" : "已下架 · 前台已撤下");
      })
      .catch(function () { toast("操作失败 · 请稍后重试"); });
  }

  function askDelete(item) {
    if (!item) return;
    state.pendingDelete = item;
    delDlgText.textContent = "删除 " + item.no + "「" + item.name + "」？D1 里的这一行不可恢复，前台展柜会立刻撤下。";
    if (typeof delDlg.showModal === "function") delDlg.showModal();
  }
  function confirmDelete() {
    var item = state.pendingDelete;
    state.pendingDelete = null;
    if (typeof delDlg.close === "function") delDlg.close();
    if (!item) return;
    request("DELETE", API + "/" + encodeURIComponent(item.id))
      .then(function (res) {
        return readJson(res).then(function (body) {
          return { status: res.status, ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 401) { authFailed(); return; }
        if (result.status === 503) { adminMissing(); return; }
        if (!result.ok && result.status !== 404) throw new Error("HTTP " + result.status);
        toast("已删除 " + item.no);
        if (state.selectedId === item.id) state.selectedId = null;
        if (state.items.length === 1 && state.page > 1) state.page -= 1;
        loadData();
      })
      .catch(function () { toast("删除失败 · 请稍后重试"); });
  }

  /* ---------------- 令牌操作 ---------------- */
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
    toast("令牌已保存 · 正在读取展柜");
    setLoading(false);
    state.page = 1;
    loadData();
  }
  function clearToken() {
    removeStore(TOKEN_KEY);
    tokenInput.value = "";
    state.items = [];
    state.total = 0;
    state.pages = 1;
    state.selectedId = null;
    grid.innerHTML = "";
    setTokenState("未填写");
    showAuth("info", "尚未填写管理令牌", "填入 ADMIN_TOKEN 后点「保存令牌」；令牌只存在本机浏览器 localStorage（myon-admin-token）。");
    showState("LOCK", "需要管理令牌", "填好令牌后会自动读取展柜数据。", false);
    renderAll();
    toast("已清除本机令牌");
  }

  /* ---------------- 事件绑定 ---------------- */
  grid.addEventListener("click", function (event) {
    var act = event.target.closest(".g-act");
    if (act) {
      var card = act.closest(".g-card");
      var item = card ? findItem(card.getAttribute("data-id")) : null;
      var type = act.getAttribute("data-act");
      if (type === "edit") openEditor(item);
      else if (type === "toggle") toggleItem(item);
      else if (type === "del") askDelete(item);
      return;
    }
    var target = event.target.closest(".g-card");
    if (target) selectItem(target.getAttribute("data-id"), false);
  });
  grid.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var card = event.target.closest(".g-card");
    if (!card || event.target.closest(".g-act")) return;
    event.preventDefault();
    selectItem(card.getAttribute("data-id"), false);
  });

  catBtns.addEventListener("click", function (event) {
    var btn = event.target.closest(".cat");
    if (!btn) return;
    state.filter = btn.getAttribute("data-cat");
    renderCats();
    renderGrid();
  });

  sortSelect.addEventListener("change", function () {
    state.sort = sortSelect.value;
    renderGrid();
  });

  pgPrev.addEventListener("click", function () {
    if (state.loading || state.page <= 1) return;
    state.page -= 1;
    loadData();
  });
  pgNext.addEventListener("click", function () {
    if (state.loading || state.page >= state.pages) return;
    state.page += 1;
    loadData();
  });

  slotMap.addEventListener("click", function (event) {
    var btn = event.target.closest(".slot");
    if (!btn) return;
    var slot = parseInt(btn.getAttribute("data-slot"), 10);
    var found = null;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].position === slot) { found = state.items[i]; break; }
    }
    if (found) selectItem(found.id, true);
    else toast("第 " + slot + " 位是空的 · 在编辑表单里改 position");
  });

  recentList.addEventListener("click", function (event) {
    var row = event.target.closest(".recent-row");
    if (row) selectItem(row.getAttribute("data-id"), true);
  });

  $("btnAdd").addEventListener("click", function () { openEditor(null); });
  btnEditSel.addEventListener("click", function () { openEditor(findItem(state.selectedId)); });
  btnToggleSel.addEventListener("click", function () { toggleItem(findItem(state.selectedId)); });
  btnDelSel.addEventListener("click", function () { askDelete(findItem(state.selectedId)); });

  retryBtn.addEventListener("click", function () { loadData(); });
  $("tokenSave").addEventListener("click", saveToken);
  $("tokenClear").addEventListener("click", clearToken);
  tokenInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      saveToken();
    }
  });

  editForm.addEventListener("submit", submitEditor);
  editCancel.addEventListener("click", closeEditor);
  $("fMedia").addEventListener("input", updatePreview);
  editDlg.addEventListener("click", function (event) {
    if (event.target === editDlg) closeEditor();
  });
  editDlg.addEventListener("close", function () { state.editing = null; });

  delCancel.addEventListener("click", function () {
    state.pendingDelete = null;
    if (typeof delDlg.close === "function") delDlg.close();
  });
  delOk.addEventListener("click", confirmDelete);
  delDlg.addEventListener("click", function (event) {
    if (event.target === delDlg) {
      state.pendingDelete = null;
      if (typeof delDlg.close === "function") delDlg.close();
    }
  });

  /* ---------------- 初始化 ---------------- */
  tokenInput.value = tokenValue();
  sortSelect.value = state.sort;
  renderCatOptions();
  renderSlots();
  paintHeader();
  renderRecent();
  loadData();
})();
