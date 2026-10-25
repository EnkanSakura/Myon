(function () {
  "use strict";

  /* ---------------- 常量与工具 ---------------- */
  var TOKEN_KEY = "myon-admin-token";
  var MAX_BYTES = 8 * 1024 * 1024;
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
  var btnUpload = $("btnUpload");
  var fileInput = $("fileInput");
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
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".filterbar .chip"));
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

  /* ---------------- 页面状态 ---------------- */
  var state = {
    items: [],
    total: 0,
    limit: 30,
    page: 1,
    pages: 1,
    type: "all",
    q: "",
    sort: "added",
    selected: {},
    stats: null,
    loading: false,
    busy: false,
    pendingDelete: []
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

  /* ---------------- 展示工具 ---------------- */
  function mediaUrl(key) {
    if (!key) return "";
    return MEDIA_BASE + String(key).replace(/^\/+/, "");
  }
  function absoluteUrl(key) { return location.origin + mediaUrl(key); }
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

  /** 筛选栏只保留一个计数：本页通过了类型与关键词筛选的数量。 */
  function paintFilterCount() {
    if (!fbCount) return;
    var shown = visibleItems().length;
    fbCount.textContent = "显示 " + shown + " 个 · 筛选只作用于本页";
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
    var list = visibleItems();
    if (state.total === 0) {
      empty.hidden = false;
      emptyReset.hidden = false;
      emptyText.textContent = "媒体库还是空的，先上传一张图片。";
      emptyReset.textContent = "选择文件上传";
    } else if (list.length === 0) {
      empty.hidden = false;
      emptyReset.hidden = false;
      emptyText.textContent = "没有符合条件的文件。换个类型或关键词试试。";
      emptyReset.textContent = "清除筛选";
    } else {
      empty.hidden = true;
    }
  }

  /* ---------------- 过滤 / 排序 ---------------- */
  function visibleItems() {
    var list = state.items.filter(function (item) {
      var typeOk = state.type === "all" || (state.type === "img" ? isImage(item) : !isImage(item));
      var name = String(item.filename || "").toLowerCase();
      var qOk = !state.q || name.indexOf(state.q) >= 0;
      return typeOk && qOk;
    });
    if (state.sort === "size") {
      list.sort(function (a, b) { return (b.size || 0) - (a.size || 0); });
    } else if (state.sort === "name") {
      list.sort(function (a, b) { return String(a.filename).localeCompare(String(b.filename)); });
    } else {
      list.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    }
    return list;
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
      img.src = mediaUrl(item.key);
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

    var mover = el("div", "mover");
    var copyBtn = el("button", "mo", "复制链接");
    copyBtn.type = "button";
    copyBtn.setAttribute("data-act", "copy");
    var delBtn = el("button", "mo mo--del", "删除");
    delBtn.type = "button";
    delBtn.setAttribute("data-act", "del");
    mover.appendChild(copyBtn);
    mover.appendChild(delBtn);
    thumb.appendChild(mover);

    var meta = el("div", "mmeta");
    meta.appendChild(el("span", "mname", item.filename || item.key || "未命名"));
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
    visibleItems().forEach(function (item) { grid.appendChild(cardFor(item)); });
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
    state.selected = {};
    state.loading = false;
    loadingEl.hidden = true;
    grid.innerHTML = "";
    grid.setAttribute("aria-busy", "false");
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
    var url = API + "?limit=" + state.limit + "&offset=" + (state.page - 1) * state.limit;

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
        state.selected = {};
        if (state.page > state.pages) {
          state.page = state.pages;
          loadData();
          return;
        }
        setLoading(false);
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

  /* ---------------- 删除 ---------------- */
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

  function xhrUpload(file, onProgress, done) {
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
            xhrUpload(prepared, function (pct) {
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
    state.type = "all";
    state.q = "";
    state.sort = "added";
    qInput.value = "";
    sortSel.value = "added";
    each(tabs, function (tab) {
      var on = tab.getAttribute("data-type") === "all";
      tab.classList.toggle("is-on", on);
      tab.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderGrid();
  }

  /* ---------------- 事件绑定 ---------------- */
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
      if (action.getAttribute("data-act") === "copy") copyText(absoluteUrl(actionItem.key));
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

  each(tabs, function (tab) {
    tab.addEventListener("click", function () {
      state.type = tab.getAttribute("data-type");
      each(tabs, function (other) {
        var on = other === tab;
        other.classList.toggle("is-on", on);
        other.setAttribute("aria-pressed", on ? "true" : "false");
      });
      renderGrid();
    });
  });
  qInput.addEventListener("input", function () {
    state.q = qInput.value.trim().toLowerCase();
    renderGrid();
  });
  sortSel.addEventListener("change", function () {
    state.sort = sortSel.value;
    renderGrid();
  });
  clearFilters.addEventListener("click", resetFilters);

  emptyReset.addEventListener("click", function () {
    if (state.total === 0) fileInput.click();
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
  delDlg.addEventListener("click", function (event) {
    if (event.target === delDlg) {
      state.pendingDelete = [];
      if (typeof delDlg.close === "function") delDlg.close();
    }
  });

  /* ---------------- 初始化 ---------------- */
  sortSel.value = state.sort;
  paintSummary();
  loadData();
})();
